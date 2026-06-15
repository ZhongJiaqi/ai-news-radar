import assert from 'node:assert/strict'
import test from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  countAvailableModels,
  discoverModels,
  getDynamicChain,
  markModelFailure,
  markModelSuccess,
  probeModel,
  reviveExhaustedModels,
} from './discovery'

// ----------- minimal SupabaseClient mock -----------
// Captures every .from(table).<op>(...) call and lets each test return
// canned data per op. Builder chain is recorded into `calls`.

type CapturedCall = {
  table: string
  op: 'select' | 'upsert' | 'update'
  payload?: unknown
  filters: Record<string, unknown>
  options?: Record<string, unknown>
}

interface MockResponse {
  data?: unknown
  error?: unknown
  count?: number | null
}

function makeMockClient(responses: {
  select?: MockResponse | ((c: CapturedCall) => MockResponse)
  upsert?: MockResponse | ((c: CapturedCall) => MockResponse)
  update?: MockResponse | ((c: CapturedCall) => MockResponse)
}) {
  const calls: CapturedCall[] = []

  function builder(table: string, op: CapturedCall['op'], payload?: unknown, options?: Record<string, unknown>) {
    const captured: CapturedCall = { table, op, payload, filters: {}, options }
    calls.push(captured)

    const resolver = () => {
      const r = responses[op]
      const resp = typeof r === 'function' ? r(captured) : r
      return Promise.resolve(resp || { data: null, error: null, count: null })
    }

    const chain: any = {
      eq(col: string, val: unknown) {
        captured.filters[col] = val
        return chain
      },
      lt(col: string, val: unknown) {
        captured.filters[`__lt_${col}`] = val
        return chain
      },
      order(_col: string, _opts?: unknown) {
        return chain
      },
      limit(_n: number) {
        return chain
      },
      select(_cols?: string, _options?: Record<string, unknown>) {
        return chain
      },
      maybeSingle() {
        return resolver().then((r: MockResponse) => ({
          data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null,
          error: r.error ?? null,
        }))
      },
      then(onFulfilled: (v: any) => any) {
        return resolver().then(onFulfilled)
      },
    }
    return chain
  }

  const client = {
    from(table: string) {
      return {
        select: (cols?: string, options?: Record<string, unknown>) =>
          builder(table, 'select', cols, options),
        upsert: (payload: unknown, options?: Record<string, unknown>) =>
          builder(table, 'upsert', payload, options),
        update: (payload: unknown) => builder(table, 'update', payload),
      }
    },
  } as unknown as SupabaseClient

  return { client, calls }
}

// ----------------- markModelSuccess -----------------

test('markModelSuccess: writes available + bumps latency EMA', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { avg_latency_ms: 1000, success_count: 4 } },
    upsert: { data: null },
  })

  await markModelSuccess(client, 'dashscope', 'qwen-plus', 2000)

  const upsert = calls.find(c => c.op === 'upsert')
  assert.ok(upsert, 'upsert should be called')
  const payload = upsert!.payload as Record<string, unknown>
  assert.equal(payload.status, 'available')
  assert.equal(payload.exhausted_until, null)
  assert.equal(payload.provider, 'dashscope')
  assert.equal(payload.model_id, 'qwen-plus')
  assert.equal(payload.success_count, 5)
  // EMA(1000, 2000, alpha=0.3) = round(1000 * 0.7 + 2000 * 0.3) = 1300
  assert.equal(payload.avg_latency_ms, 1300)
  assert.equal(upsert!.options?.onConflict, 'provider,model_id')
})

test('markModelSuccess: first observation initializes count and latency', async () => {
  const { client, calls } = makeMockClient({
    select: { data: null },
    upsert: { data: null },
  })

  await markModelSuccess(client, 'dashscope', 'new-model', 1234)

  const upsert = calls.find(c => c.op === 'upsert')!
  const payload = upsert.payload as Record<string, unknown>
  assert.equal(payload.success_count, 1)
  assert.equal(payload.avg_latency_ms, 1234)
})

// ----------------- markModelFailure -----------------

test('markModelFailure: 403 + quota text → exhausted with ~next UTC midnight', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 2 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 403,
    message: 'Free tier exhausted, please upgrade',
  })

  const upsert = calls.find(c => c.op === 'upsert')!
  const payload = upsert.payload as Record<string, unknown>
  assert.equal(payload.status, 'exhausted')
  assert.equal(payload.failure_count, 3)
  // exhausted_until should be a future ISO datetime
  const until = new Date(payload.exhausted_until as string)
  assert.ok(until.getTime() > Date.now(), 'exhausted_until must be in the future')
  assert.ok(
    until.getTime() < Date.now() + 25 * 3600_000,
    'exhausted_until should be within 25h'
  )
})

test('markModelFailure: 429 → exhausted', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 0 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 429,
    message: 'Too Many Requests',
  })

  const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
  assert.equal(payload.status, 'exhausted')
})

test('markModelFailure: 401 → broken (auth failure, not quota)', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 0 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 401,
    message: 'Unauthorized',
  })

  const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
  assert.equal(payload.status, 'broken')
  assert.equal(payload.exhausted_until, null)
})

test('markModelFailure: 400 prompt error → does NOT change status', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 5 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 400,
    message: 'bad input',
  })

  const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
  assert.equal(payload.status, undefined, 'status should be left untouched')
  assert.equal(payload.failure_count, 6)
})

// ----------------- reviveExhaustedModels -----------------

test('reviveExhaustedModels: updates exhausted rows past their window', async () => {
  const { client, calls } = makeMockClient({
    update: { data: [{ model_id: 'qwen-plus' }, { model_id: 'qwen-max' }] },
  })

  const n = await reviveExhaustedModels(client, 'dashscope')
  assert.equal(n, 2)

  const update = calls.find(c => c.op === 'update')!
  const payload = update.payload as Record<string, unknown>
  assert.equal(payload.status, 'available')
  assert.equal(payload.exhausted_until, null)
  assert.equal(update.filters.provider, 'dashscope')
  assert.equal(update.filters.status, 'exhausted')
  // __lt_exhausted_until should be a recent ISO timestamp
  assert.ok(typeof update.filters.__lt_exhausted_until === 'string')
})

// ----------------- getDynamicChain -----------------

test('getDynamicChain: returns DB rows folded with fallback for unknown models', async () => {
  const { client } = makeMockClient({
    select: {
      data: [
        { model_id: 'qwen-plus', last_success_at: '2026-06-03T10:00:00Z', avg_latency_ms: 1500 },
        { model_id: 'qwen-max', last_success_at: '2026-06-03T08:00:00Z', avg_latency_ms: 3000 },
      ],
    },
  })

  const chain = await getDynamicChain(client, 'dashscope', [
    'qwen-plus', // already in DB
    'qwen-turbo', // not in DB → should be appended
  ])
  assert.deepEqual(chain, ['qwen-plus', 'qwen-max', 'qwen-turbo'])
})

test('getDynamicChain: falls back to env chain when DB returns empty', async () => {
  const { client } = makeMockClient({
    select: { data: [] },
  })

  const chain = await getDynamicChain(client, 'dashscope', ['qwen-plus', 'qwen-turbo'])
  assert.deepEqual(chain, ['qwen-plus', 'qwen-turbo'])
})

test('getDynamicChain: falls back on DB error', async () => {
  const { client } = makeMockClient({
    select: { data: null, error: { message: 'connection refused' } },
  })

  const chain = await getDynamicChain(client, 'dashscope', ['m1', 'm2'])
  assert.deepEqual(chain, ['m1', 'm2'])
})

// ----------------- discoverModels -----------------

test('discoverModels: UPSERTs new IDs without overwriting existing rows', async () => {
  const { client, calls } = makeMockClient({
    upsert: { data: null },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: any) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 'qwen-plus' },
        { id: 'qwen-max' },
        { id: 'qwen-new' },
      ],
    }),
    text: async () => '',
  })) as any

  try {
    const ids = await discoverModels(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake'
    )
    assert.deepEqual(ids, ['qwen-plus', 'qwen-max', 'qwen-new'])

    const upsert = calls.find(c => c.op === 'upsert')!
    const payload = upsert.payload as Array<Record<string, unknown>>
    assert.equal(payload.length, 3)
    assert.equal(payload[0].status, 'unknown')
    assert.equal(upsert.options?.onConflict, 'provider,model_id')
    assert.equal(upsert.options?.ignoreDuplicates, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('discoverModels: returns [] silently on fetch failure', async () => {
  const { client } = makeMockClient({ upsert: { data: null } })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('network down')
  }) as any

  try {
    const ids = await discoverModels(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake'
    )
    assert.deepEqual(ids, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ----------------- probeModel -----------------

test('probeModel: 200 OK → marks available and returns available', async () => {
  const { client, calls } = makeMockClient({
    select: { data: null },
    upsert: { data: null },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  })) as any

  try {
    const status = await probeModel(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake',
      'qwen-plus'
    )
    assert.equal(status, 'available')
    const upsert = calls.find(c => c.op === 'upsert')!
    const payload = upsert.payload as Record<string, unknown>
    assert.equal(payload.status, 'available')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('probeModel: 403 quota → marks exhausted', async () => {
  const { client, calls } = makeMockClient({
    select: { data: null },
    upsert: { data: null },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: false,
    status: 403,
    json: async () => ({}),
    text: async () => 'Free tier exhausted',
  })) as any

  try {
    const status = await probeModel(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake',
      'qwen-plus'
    )
    assert.equal(status, 'exhausted')
    const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
    assert.equal(payload.status, 'exhausted')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('probeModel: fetch throws (abort/network) → marks broken', async () => {
  const { client, calls } = makeMockClient({
    select: { data: null },
    upsert: { data: null },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    const err = new Error('The operation was aborted.')
    ;(err as Error & { name?: string }).name = 'AbortError'
    throw err
  }) as typeof globalThis.fetch

  try {
    const status = await probeModel(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake',
      'qwen-plus'
    )
    assert.equal(status, 'broken')
    const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
    assert.ok(payload.last_error_at, 'last_error_at written')
    assert.ok(payload.failure_count, 'failure_count bumped')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ----------------- countAvailableModels -----------------

test('countAvailableModels: returns the count from supabase query', async () => {
  const { client, calls } = makeMockClient({
    select: { data: null, error: null, count: 12 },
  })
  const n = await countAvailableModels(client, 'dashscope')
  assert.equal(n, 12)
  const sel = calls.find(c => c.op === 'select')!
  assert.equal(sel.filters.provider, 'dashscope')
  assert.equal(sel.filters.status, 'available')
})

test('countAvailableModels: returns 0 when count is null', async () => {
  const { client } = makeMockClient({
    select: { data: null, error: null, count: null },
  })
  const n = await countAvailableModels(client, 'dashscope')
  assert.equal(n, 0)
})
