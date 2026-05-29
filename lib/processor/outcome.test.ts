import assert from 'node:assert/strict'
import test from 'node:test'

import { isDuplicateKeyError, shouldAlarmProcessRun } from './outcome'

// ──────────────────────────────────────────────
// isDuplicateKeyError — Postgres unique_violation (23505)
// A 23505 on processed_articles means the article was already
// processed; it is benign, not a failure worth alarming on.
// ──────────────────────────────────────────────

test('isDuplicateKeyError is true for a Postgres 23505 error object', () => {
  const err = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "processed_articles_article_id_key"',
    details: 'Key (article_id)=(abc) already exists.',
  }
  assert.equal(isDuplicateKeyError(err), true)
})

test('isDuplicateKeyError is false for a different Postgres error code', () => {
  // 23503 = foreign_key_violation — a real problem, must NOT be swallowed
  assert.equal(isDuplicateKeyError({ code: '23503', message: 'fk violation' }), false)
})

test('isDuplicateKeyError is false for non-object / missing inputs', () => {
  assert.equal(isDuplicateKeyError(null), false)
  assert.equal(isDuplicateKeyError(undefined), false)
  assert.equal(isDuplicateKeyError('23505'), false)
  assert.equal(isDuplicateKeyError(new Error('boom')), false)
})

// ──────────────────────────────────────────────
// shouldAlarmProcessRun — decide the workflow exit code.
// Policy: alarm (exit 1) ONLY when both passes are completely
// broken by GENUINE failures. `failed` counts exclude transient
// causes (LLM quota exhaustion, already-processed duplicates),
// which the callers fold out before calling this.
// ──────────────────────────────────────────────

test('alarms when both passes are fully dead with genuine failures', () => {
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 0, failed: 3 },
    reprocessPass: { reprocessed: 0, failed: 5 },
  })
  assert.equal(alarm, true)
})

test('does NOT alarm on a pure quota day (no genuine failures)', () => {
  // Quota exhausted: new articles got fallback rows (processed),
  // reprocess produced only pending retries (failed = 0).
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 4, failed: 0 },
    reprocessPass: { reprocessed: 0, failed: 0 },
  })
  assert.equal(alarm, false)
})

test('does NOT alarm when a duplicate was resolved as processed', () => {
  // The historical trigger: the only new article was a 23505 that we
  // now fold into `processed`, so the new pass is no longer dead.
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 1, failed: 0 },
    reprocessPass: { reprocessed: 0, failed: 0 },
  })
  assert.equal(alarm, false)
})

test('does NOT alarm when there is nothing to do', () => {
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 0, failed: 0 },
    reprocessPass: { reprocessed: 0, failed: 0 },
  })
  assert.equal(alarm, false)
})

test('does NOT alarm on partial failure when some work succeeded', () => {
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 10, failed: 2 },
    reprocessPass: { reprocessed: 3, failed: 1 },
  })
  assert.equal(alarm, false)
})

test('does NOT alarm when only one pass is dead (tolerate single-pass outage)', () => {
  // New pass genuinely broke, but reprocess made progress → not systemic.
  const alarm = shouldAlarmProcessRun({
    newPass: { processed: 0, failed: 3 },
    reprocessPass: { reprocessed: 2, failed: 0 },
  })
  assert.equal(alarm, false)
})
