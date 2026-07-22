import assert from 'node:assert/strict'
import test from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  countAvailableModels,
  discoverModels,
  getDynamicChain,
  isChatCapableModelId,
  isQuotaExhaustionError,
  markModelFailure,
  markModelSuccess,
  probeModel,
  probeSweep,
  reviveExhaustedModels,
} from './discovery'

// ----------------- isQuotaExhaustionError -----------------

// Shared classifier: also drives generate()'s "swap to next model" decision
// in lib/llm/index.ts, so Arrearage recognition must live here once.
test('isQuotaExhaustionError: recognizes 400 Arrearage / overdue-payment', () => {
  assert.equal(
    isQuotaExhaustionError({ status: 400, message: 'Access denied ... Arrearage' }),
    true
  )
  assert.equal(
    isQuotaExhaustionError({ status: 400, message: 'account overdue-payment blocked' }),
    true
  )
  assert.equal(isQuotaExhaustionError({ status: 400, message: 'bad input' }), false)
  assert.equal(isQuotaExhaustionError({ status: 429, message: '' }), true)
  assert.equal(
    isQuotaExhaustionError({ status: 403, message: 'The free quota has been exhausted' }),
    true
  )
})

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

// DashScope free quotas are one-time grants, NOT daily resets: models that
// 403'd on 2026-06-04 kept failing forever (6600+ failures each). A 403
// quota error must bench the model for a long time or it becomes a zombie
// that gets revived every midnight and blocks the probe-sweep trigger.
test('markModelFailure: 403 + quota text → exhausted for ~90 days (one-time quota)', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 2 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 403,
    message: 'The free quota has been exhausted. To continue accessing the model on a paid basis...',
  })

  const upsert = calls.find(c => c.op === 'upsert')!
  const payload = upsert.payload as Record<string, unknown>
  assert.equal(payload.status, 'exhausted')
  assert.equal(payload.failure_count, 3)
  const until = new Date(payload.exhausted_until as string).getTime()
  assert.ok(until > Date.now() + 30 * 86400_000, 'exhausted_until must be at least 30d out')
  assert.ok(until < Date.now() + 120 * 86400_000, 'exhausted_until should be under 120d')
})

test('markModelFailure: 429 → exhausted only until next UTC midnight (transient)', async () => {
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
  const until = new Date(payload.exhausted_until as string).getTime()
  assert.ok(until > Date.now(), 'exhausted_until must be in the future')
  assert.ok(until < Date.now() + 25 * 3600_000, 'exhausted_until should be within 25h')
})

// Account-level arrearage (400 "Access denied ... overdue-payment") blocks
// ALL models but clears as soon as the bill is paid — bench briefly so the
// chain falls through / alerts fire, without poisoning the pool for a day.
test('markModelFailure: 400 Arrearage → exhausted with a short cooldown', async () => {
  const { client, calls } = makeMockClient({
    select: { data: { failure_count: 1 } },
    upsert: { data: null },
  })

  await markModelFailure(client, 'dashscope', 'qwen-plus', {
    status: 400,
    message: 'Access denied, please make sure your account is in good standing. Arrearage/overdue-payment.',
  })

  const payload = (calls.find(c => c.op === 'upsert')!.payload) as Record<string, unknown>
  assert.equal(payload.status, 'exhausted')
  const until = new Date(payload.exhausted_until as string).getTime()
  assert.ok(until > Date.now(), 'exhausted_until must be in the future')
  assert.ok(until < Date.now() + 3 * 3600_000, 'arrearage cooldown should be short (<3h)')
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

// ----------------- isChatCapableModelId -----------------

// 2026-07-16 incident: probe-sweep promoted qwen3.5-ocr (an OCR model that
// answers 200 OK) into the chain; it then monopolized scoring for 6 days
// producing template echoes and 1/5/10-only scores.
test('isChatCapableModelId: accepts general chat models', () => {
  for (const id of [
    'qwen3.7-plus', 'qwen3.7-max-2026-06-08', 'deepseek-v4-pro',
    'kimi-k2.6', 'kimi-k2.7-code', 'glm-5.2', 'qwen3.6-27b',
    'qwen3.6-35b-a3b', 'qwen-turbo', 'deepseek-v4-flash',
  ]) {
    assert.equal(isChatCapableModelId(id), true, `${id} should be chat-capable`)
  }
})

test('isChatCapableModelId: rejects OCR / vision / audio / media / specialist SKUs', () => {
  for (const id of [
    'qwen3.5-ocr', 'qwen3-vl-8b-base', 'qvq-max', 'qwen3.5-omni-plus',
    'qwen-audio-turbo', 'paraformer-v2', 'sambert-zhichu-v1', 'cosyvoice-v2',
    'qwen-tts', 'text-embedding-v3', 'multimodal-embedding-v1', 'gte-rerank',
    'wanx-v1', 'wan2.1-t2v-turbo', 'qwen-image-edit', 'video-captioner-v1',
    'qwen-mt-plus', 'qwen-doc-turbo', 'farui-plus', 'qwen-plus-character-2025-11-06',
    'qwen-omni-turbo-realtime',
  ]) {
    assert.equal(isChatCapableModelId(id), false, `${id} should be filtered out`)
  }
})

// ----------------- getDynamicChain -----------------

test('getDynamicChain: filters non-chat and non-whitelisted models from DB rows and fallback', async () => {
  const { client } = makeMockClient({
    select: {
      data: [
        // OCR model sits first (freshest success) — must be filtered
        { model_id: 'qwen3.5-ocr', last_success_at: '2026-07-22T03:00:00Z', avg_latency_ms: 900 },
        { model_id: 'qwen3.7-plus', last_success_at: '2026-07-13T10:00:00Z', avg_latency_ms: 1500 },
        // available in DB but never on the official free list — must be filtered
        { model_id: 'glm-5.1', last_success_at: null, avg_latency_ms: null },
      ],
    },
  })

  const chain = await getDynamicChain(client, 'dashscope', ['qwen-turbo', 'some-unverified-model'])
  assert.deepEqual(chain, ['qwen3.7-plus', 'qwen-turbo'])
})

test('getDynamicChain: returns DB rows folded with fallback for unknown models', async () => {
  const { client } = makeMockClient({
    select: {
      data: [
        { model_id: 'qwen3.7-plus', last_success_at: '2026-06-03T10:00:00Z', avg_latency_ms: 1500 },
        { model_id: 'qwen3.7-max', last_success_at: '2026-06-03T08:00:00Z', avg_latency_ms: 3000 },
      ],
    },
  })

  const chain = await getDynamicChain(client, 'dashscope', [
    'qwen3.7-plus', // already in DB
    'qwen-turbo', // not in DB → should be appended
  ])
  assert.deepEqual(chain, ['qwen3.7-plus', 'qwen3.7-max', 'qwen-turbo'])
})

test('getDynamicChain: falls back to env chain when DB returns empty', async () => {
  const { client } = makeMockClient({
    select: { data: [] },
  })

  const chain = await getDynamicChain(client, 'dashscope', ['qwen3.7-plus', 'qwen-turbo'])
  assert.deepEqual(chain, ['qwen3.7-plus', 'qwen-turbo'])
})

test('getDynamicChain: falls back on DB error, still whitelist-filtered', async () => {
  const { client } = makeMockClient({
    select: { data: null, error: { message: 'connection refused' } },
  })

  const chain = await getDynamicChain(client, 'dashscope', ['qwen3.6-plus', 'not-a-verified-model'])
  assert.deepEqual(chain, ['qwen3.6-plus'])
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

// ----------------- probeSweep -----------------

test('probeSweep: probes only whitelisted chat models, marks non-chat SKUs broken', async () => {
  let probeCalls = 0
  const { client, calls } = makeMockClient({
    select: (c) => {
      // sweep's unknown-pool query vs markModelSuccess's telemetry read
      if (c.filters.status === 'unknown') {
        return {
          data: [
            { model_id: 'qwen3.5-ocr' },       // chat-incapable → mark broken, never probe
            { model_id: 'glm-5.2' },           // whitelisted chat model → probe
            { model_id: 'mystery-chat-model' } // unverified → leave unknown, never probe
          ],
        }
      }
      return { data: null }
    },
    upsert: { data: null },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    probeCalls++
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
  }) as any

  try {
    const promoted = await probeSweep(
      client,
      'dashscope',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'sk-fake',
      30
    )
    assert.deepEqual(promoted, ['glm-5.2'])
    assert.equal(probeCalls, 1, 'only the whitelisted chat model gets probed')

    const brokenUpsert = calls.find(
      c => c.op === 'upsert' && Array.isArray(c.payload)
        && (c.payload as Array<Record<string, unknown>>).some(r => r.model_id === 'qwen3.5-ocr')
    )
    assert.ok(brokenUpsert, 'non-chat SKUs should be batch-marked')
    const rows = brokenUpsert!.payload as Array<Record<string, unknown>>
    assert.equal(rows.length, 1, 'unverified-but-chat-capable models must NOT be marked broken')
    assert.equal(rows[0].status, 'broken')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ----------------- countAvailableModels -----------------

test('countAvailableModels: counts only chain-eligible available rows', async () => {
  const { client, calls } = makeMockClient({
    select: {
      data: [
        { model_id: 'glm-5.1' },      // available but never verified free
        { model_id: 'qwen3.5-ocr' },  // available but not chat-capable
        { model_id: 'qwen3.7-plus' }, // eligible
      ],
    },
  })
  const n = await countAvailableModels(client, 'dashscope')
  assert.equal(n, 1)
  const sel = calls.find(c => c.op === 'select')!
  assert.equal(sel.filters.provider, 'dashscope')
  assert.equal(sel.filters.status, 'available')
})

test('countAvailableModels: returns 0 when no rows', async () => {
  const { client } = makeMockClient({
    select: { data: null, error: null, count: null },
  })
  const n = await countAvailableModels(client, 'dashscope')
  assert.equal(n, 0)
})
