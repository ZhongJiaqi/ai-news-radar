import assert from 'node:assert/strict'
import test from 'node:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import { markPoolEmptyNotified, shouldNotifyPoolEmpty } from './poolEmptyAlert'

// Minimal supabase mock in the discovery.test.ts style: capture calls,
// serve canned responses per op.
type CapturedCall = {
  op: 'select' | 'upsert'
  payload?: unknown
  filters: Record<string, unknown>
}

function makeMockClient(selectData: unknown) {
  const calls: CapturedCall[] = []

  function builder(op: CapturedCall['op'], payload?: unknown) {
    const captured: CapturedCall = { op, payload, filters: {} }
    calls.push(captured)
    const chain: any = {
      eq(col: string, val: unknown) {
        captured.filters[col] = val
        return chain
      },
      select() {
        return chain
      },
      maybeSingle() {
        return Promise.resolve({ data: selectData, error: null })
      },
      then(onFulfilled: (v: any) => any) {
        return Promise.resolve({ data: null, error: null }).then(onFulfilled)
      },
    }
    return chain
  }

  const client = {
    from() {
      return {
        select: () => builder('select'),
        upsert: (payload: unknown, options?: Record<string, unknown>) => {
          const b = builder('upsert', payload)
          ;(calls[calls.length - 1] as any).options = options
          return b
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, calls }
}

const NOW = new Date('2026-07-31T08:00:00Z')

test('shouldNotifyPoolEmpty: true when no sentinel row exists (never notified)', async () => {
  const { client } = makeMockClient(null)
  assert.equal(await shouldNotifyPoolEmpty(client, NOW), true)
})

test('shouldNotifyPoolEmpty: false when last notification was 3h ago (throttled)', async () => {
  const { client } = makeMockClient({
    last_error_at: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
  })
  assert.equal(await shouldNotifyPoolEmpty(client, NOW), false)
})

test('shouldNotifyPoolEmpty: true again when last notification was 25h ago', async () => {
  const { client } = makeMockClient({
    last_error_at: new Date(NOW.getTime() - 25 * 3600_000).toISOString(),
  })
  assert.equal(await shouldNotifyPoolEmpty(client, NOW), true)
})

test('markPoolEmptyNotified: upserts the sentinel row outside any real provider', async () => {
  const { client, calls } = makeMockClient(null)
  await markPoolEmptyNotified(client, NOW)

  const upsert = calls.find(c => c.op === 'upsert')!
  assert.ok(upsert, 'upsert should be called')
  const payload = upsert.payload as Record<string, unknown>
  // Sentinel must not collide with any real provider ('dashscope' etc.) —
  // every business query filters on provider, so '_meta' rows stay invisible.
  assert.equal(payload.provider, '_meta')
  assert.equal(payload.model_id, 'pool-empty-alert')
  assert.equal(payload.last_error_at, NOW.toISOString())
  assert.equal((upsert as any).options?.onConflict, 'provider,model_id')
})
