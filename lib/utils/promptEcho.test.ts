import assert from 'node:assert/strict'
import test from 'node:test'

import { looksLikePromptEcho } from './promptEcho'

test('looksLikePromptEcho: detects the article-prompt template echoed verbatim', () => {
  assert.equal(looksLikePromptEcho('2-3句话的中文摘要，说清楚是什么、有什么变化'), true)
  // pangu-spaced variant as stored in production rows
  assert.equal(looksLikePromptEcho('2-3 句话的中文摘要，说清楚是什么、有什么变化'), true)
  assert.equal(looksLikePromptEcho('标题: X\n内容摘要: 3-4 句话的中文摘要，说清楚是什么'), true)
})

test('looksLikePromptEcho: passes real summaries through', () => {
  assert.equal(
    looksLikePromptEcho('xAI 在 OpenAI 诉讼案中承认 Grok 训练数据来自 ChatGPT 蒸馏。'),
    false
  )
  assert.equal(looksLikePromptEcho(''), false)
  assert.equal(looksLikePromptEcho(null), false)
  assert.equal(looksLikePromptEcho(undefined), false)
})
