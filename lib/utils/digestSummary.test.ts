import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { isUsableSummary, summaryLines } from './digestSummary'

test('isUsableSummary returns false for null / undefined / empty', () => {
  assert.equal(isUsableSummary(null), false)
  assert.equal(isUsableSummary(undefined), false)
  assert.equal(isUsableSummary(''), false)
})

test('isUsableSummary rejects the hard-fallback single paragraph', () => {
  // This matches the exact shape lib/processor/digest.ts:181 emits when
  // every LLM attempt times out — one long paragraph, no newlines.
  const hardFallback =
    '今日共收录 30 条 AI 资讯。重点包括：OpenAI 发布新模型；Anthropic 完成融资；Google 推出新工具；Meta 开源模型；微软扩展业务。整体来看，大模型能力与产品化落地继续并行推进，开源生态与算力/基础设施仍是高频主题。建议关注头部模型与关键工具更新带来的研发效率、成本结构与商业化机会变化。'
  assert.equal(isUsableSummary(hardFallback), false)
})

test('isUsableSummary accepts a real multi-bullet summary', () => {
  const real = [
    'OpenAI 发布 GPT-5，标志着大模型能力进入新阶段，开发者应重新评估技术栈。',
    'Anthropic 完成 H 轮融资，估值再创新高，AI 安全赛道受资本追捧。',
    'Google 推出 Gemini 3，多模态能力领先，企业用户应关注落地场景。',
  ].join('\n')
  assert.equal(isUsableSummary(real), true)
})

test('isUsableSummary still passes when there are exactly two real bullets', () => {
  const two = [
    'OpenAI 发布 GPT-5，标志着大模型能力进入新阶段，开发者应重新评估技术栈。',
    'Anthropic 完成 H 轮融资，估值再创新高，AI 安全赛道受资本追捧。',
  ].join('\n')
  assert.equal(isUsableSummary(two), true)
})

test('isUsableSummary fails when there is only one real bullet', () => {
  const one =
    'OpenAI 发布 GPT-5，标志着大模型能力进入新阶段，开发者应重新评估技术栈。'
  assert.equal(isUsableSummary(one), false)
})

test('isUsableSummary rejects a summary that echoes the prompt template', () => {
  // 2026-07-22 production incident: qwen3.5-ocr copied the JSON template
  // placeholder straight into summary_top8. Enough bullets, but garbage.
  const echoed = [
    '1. [🔴 极重要] agegr/pi-web - Web UI for the pi coding agent',
    '2-3 句话的中文摘要，说清楚是什么、有什么变化',
    '3. [🟠 重要] 另一条看起来正常长度的要点，但整份摘要已被模板污染。',
  ].join('\n')
  assert.equal(isUsableSummary(echoed), false)
})

test('summaryLines filters out short / whitespace-only lines', () => {
  const raw = [
    'OpenAI 发布 GPT-5，标志着大模型能力进入新阶段，开发者应重新评估技术栈。',
    'ok',
    '   ',
    'Anthropic 完成 H 轮融资，估值再创新高，AI 安全赛道受资本追捧。',
  ].join('\n')
  assert.equal(summaryLines(raw).length, 2)
})

test('summaryLines caps at 4 bullets even if more present', () => {
  const lines = Array.from({ length: 8 }, (_, i) =>
    `要点${i + 1}：这是第 ${i + 1} 条带有足够字符的中文要点，确保过了 MIN_BULLET_CHARS 阈值。`
  )
  assert.equal(summaryLines(lines.join('\n')).length, 4)
})
