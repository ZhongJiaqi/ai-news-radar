import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queryWithRetry } from './db'

const FAST = { retries: 2, delayMs: 1, timeoutMs: 200 }

test('returns the result on the first successful attempt (no retry)', async () => {
  let calls = 0
  const res = await queryWithRetry(async () => {
    calls++
    return { data: 'ok', error: null }
  }, FAST)
  assert.equal(res.data, 'ok')
  assert.equal(res.error, null)
  assert.equal(calls, 1)
})

test('retries on an error result and returns success when a later attempt succeeds', async () => {
  let calls = 0
  const res = await queryWithRetry(async () => {
    calls++
    if (calls < 2) return { data: null, error: { message: 'fetch failed' } }
    return { data: 'recovered', error: null }
  }, FAST)
  assert.equal(res.data, 'recovered')
  assert.equal(res.error, null)
  assert.equal(calls, 2)
})

test('returns the last error result after exhausting retries', async () => {
  let calls = 0
  const res = await queryWithRetry(async () => {
    calls++
    return { data: null, error: { message: 'fetch failed' } }
  }, FAST)
  assert.equal(res.data, null)
  assert.equal((res.error as { message: string }).message, 'fetch failed')
  assert.equal(calls, 3) // initial + 2 retries
})

test('treats a thrown error as a failed attempt and retries', async () => {
  let calls = 0
  const res = await queryWithRetry(async () => {
    calls++
    if (calls < 3) throw new Error('boom')
    return { data: 'ok', error: null }
  }, FAST)
  assert.equal(res.data, 'ok')
  assert.equal(calls, 3)
})

test('times out a hanging attempt then retries', async () => {
  let calls = 0
  const res = await queryWithRetry(() => {
    calls++
    // First attempt hangs forever; later attempts resolve fast.
    if (calls === 1) return new Promise(() => {})
    return Promise.resolve({ data: 'ok', error: null })
  }, { retries: 2, delayMs: 1, timeoutMs: 30 })
  assert.equal(res.data, 'ok')
  assert.ok(calls >= 2)
})
