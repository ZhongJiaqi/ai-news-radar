import assert from 'node:assert/strict'
import test from 'node:test'

import { CONFIRMED_FREE_CHAT_MODELS, isConfirmedFreeModel } from './free-models'

test('isConfirmedFreeModel: accepts models from the official free-tier list', () => {
  assert.equal(isConfirmedFreeModel('glm-5.2'), true)
  assert.equal(isConfirmedFreeModel('deepseek-v4-flash-0731'), true)
  assert.equal(isConfirmedFreeModel('qwen3.8-max'), true)
  assert.equal(isConfirmedFreeModel('kimi-k2.7-code'), true)
  assert.equal(isConfirmedFreeModel('qwen3.6-plus-2026-04-02'), true)
  assert.equal(isConfirmedFreeModel('qwen3.7-max-2026-06-08'), true)
  assert.equal(isConfirmedFreeModel('qwen3.7-plus'), true)
  // user-confirmed free with remaining quota, 2026-07-31 console check
  assert.equal(isConfirmedFreeModel('qwen3.7-flash-2026-07-15'), true)
})

test('isConfirmedFreeModel: rejects paid or unverified models', () => {
  // paid (freeTierOnly=false per aliyun 2026-06-20 data)
  assert.equal(isConfirmedFreeModel('qwen3.5-omni-plus'), false)
  assert.equal(isConfirmedFreeModel('MiniMax/MiniMax-M3'), false)
  // never appeared in the official free list — unverified, must not be probed
  assert.equal(isConfirmedFreeModel('glm-5.1'), false)
  assert.equal(isConfirmedFreeModel('qwen4-super-new'), false)
})

test('CONFIRMED_FREE_CHAT_MODELS: is a non-empty deduplicated list', () => {
  assert.ok(CONFIRMED_FREE_CHAT_MODELS.length >= 18)
  assert.equal(new Set(CONFIRMED_FREE_CHAT_MODELS).size, CONFIRMED_FREE_CHAT_MODELS.length)
})
