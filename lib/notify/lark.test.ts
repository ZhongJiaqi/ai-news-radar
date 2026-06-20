import { test } from 'node:test'
import { strict as assert } from 'node:assert'

import { buildLarkAlertCard, buildLarkCard, sendLarkCard } from './lark'

const SAMPLE_BULLETS = [
  'OpenAI 发布 GPT-5，标志着大模型能力进入新阶段，开发者应重新评估技术栈。',
  'Anthropic 完成 H 轮融资，估值再创新高，AI 安全赛道受资本追捧。',
  'Google 推出 Gemini 3，多模态能力领先，企业用户应关注落地场景。',
  'Meta 开源 Llama 4，社区生态进一步丰富，独立开发者得以低成本试验。',
]

const SAMPLE_TOP = [
  {
    title: 'OpenAI ships GPT-5',
    url: 'https://example.com/a',
    source: 'TechCrunch',
    score: 9,
  },
  {
    title: 'Anthropic raises Series H',
    url: 'https://example.com/b',
    source: 'The Information',
    score: 8,
  },
  {
    title: 'Google Gemini 3 ships',
    url: 'https://example.com/c',
    source: 'The Verge',
    score: 7,
  },
]

test('buildLarkCard: emits interactive card with header containing keyword + date', () => {
  const card = buildLarkCard('2026-06-16', SAMPLE_BULLETS, SAMPLE_TOP)
  assert.equal(card.msg_type, 'interactive')
  assert.equal(card.card.header.title.tag, 'plain_text')
  assert.ok(
    card.card.header.title.content.includes('Radar'),
    'keyword "Radar" must be in title (Lark keyword filter)'
  )
  assert.ok(card.card.header.title.content.includes('AI News Radar'))
  assert.ok(card.card.header.title.content.includes('2026-06-16'))
})

test('buildLarkCard: bullets render as numbered lark_md, capped at 4', () => {
  const extras = [...SAMPLE_BULLETS, 'extra 5', 'extra 6']
  const card = buildLarkCard('2026-06-16', extras, SAMPLE_TOP)
  const bulletsDiv = card.card.elements[0] as {
    text: { content: string }
  }
  assert.ok(bulletsDiv.text.content.startsWith('**今日要点**'))
  assert.ok(bulletsDiv.text.content.includes('**1.**'))
  assert.ok(bulletsDiv.text.content.includes('**4.**'))
  assert.ok(!bulletsDiv.text.content.includes('**5.**'), 'must cap at 4')
})

test('buildLarkCard: top stories render with title link + source + score, capped at 3', () => {
  const card = buildLarkCard('2026-06-16', SAMPLE_BULLETS, [
    ...SAMPLE_TOP,
    { title: 'should be dropped', url: 'https://example.com/d' },
  ])
  const topDiv = card.card.elements[2] as { text: { content: string } }
  assert.ok(topDiv.text.content.startsWith('**Top Stories**'))
  assert.ok(topDiv.text.content.includes('[OpenAI ships GPT-5](https://example.com/a)'))
  assert.ok(topDiv.text.content.includes('TechCrunch'))
  assert.ok(topDiv.text.content.includes('🔴 9'))
  assert.ok(!topDiv.text.content.includes('should be dropped'), 'must cap at 3')
})

test('buildLarkCard: button action points at /digest', () => {
  const card = buildLarkCard('2026-06-16', SAMPLE_BULLETS, SAMPLE_TOP)
  const actionEl = card.card.elements[4] as {
    actions: Array<{ url: string; type: string }>
  }
  assert.equal(actionEl.actions[0].type, 'primary')
  assert.equal(
    actionEl.actions[0].url,
    'https://ai-radar-delta.vercel.app/digest'
  )
})

test('buildLarkCard: empty inputs render placeholder text instead of empty blocks', () => {
  const card = buildLarkCard('2026-06-16', [], [])
  const bulletsDiv = card.card.elements[0] as { text: { content: string } }
  const topDiv = card.card.elements[2] as { text: { content: string } }
  assert.ok(bulletsDiv.text.content.includes('暂无要点'))
  assert.ok(topDiv.text.content.includes('暂无头条'))
})

test('sendLarkCard: 200 + {code:0} returns ok', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => '{"code":0,"msg":"success"}',
  })) as unknown as typeof globalThis.fetch
  try {
    const res = await sendLarkCard(
      'https://open.feishu.cn/open-apis/bot/v2/hook/fake',
      buildLarkCard('2026-06-16', SAMPLE_BULLETS, SAMPLE_TOP)
    )
    assert.equal(res.ok, true)
    assert.equal(res.status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sendLarkCard: 200 + legacy {StatusCode:0} also returns ok', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => '{"StatusCode":0,"StatusMessage":"success"}',
  })) as unknown as typeof globalThis.fetch
  try {
    const res = await sendLarkCard(
      'https://open.feishu.cn/open-apis/bot/v2/hook/fake',
      buildLarkCard('2026-06-16', SAMPLE_BULLETS, SAMPLE_TOP)
    )
    assert.equal(res.ok, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('buildLarkAlertCard: red template + 🚨 + keyword "Radar" + 告警 + type in title', () => {
  const card = buildLarkAlertCard({
    type: 'LLM 全链路失败',
    subtitle: '今日 digest 走了 heuristic fallback',
  })
  assert.equal(card.msg_type, 'interactive')
  assert.equal(card.card.header.template, 'red')
  const title = card.card.header.title.content
  assert.ok(title.includes('🚨'), 'alert prefix emoji required')
  assert.ok(title.includes('Radar'), 'Lark keyword filter requires "Radar"')
  assert.ok(title.includes('告警'), 'separate alert keyword for future muting')
  assert.ok(title.includes('LLM 全链路失败'), 'type must appear in title')
})

test('buildLarkAlertCard: subtitle rendered bold + details as bullet list', () => {
  const card = buildLarkAlertCard({
    type: '测试',
    subtitle: '主标题文案',
    details: ['原因 A', '原因 B', '建议 C'],
  })
  const body = card.card.elements[0] as { text: { content: string } }
  assert.ok(body.text.content.includes('**主标题文案**'))
  assert.ok(body.text.content.includes('- 原因 A'))
  assert.ok(body.text.content.includes('- 原因 B'))
  assert.ok(body.text.content.includes('- 建议 C'))
})

test('buildLarkAlertCard: filters empty/whitespace detail lines', () => {
  const card = buildLarkAlertCard({
    type: '测试',
    subtitle: 's',
    details: ['real', '  ', '', '\t', 'another'],
  })
  const body = card.card.elements[0] as { text: { content: string } }
  assert.ok(body.text.content.includes('- real'))
  assert.ok(body.text.content.includes('- another'))
  assert.ok(
    !body.text.content.includes('- \n'),
    'empty bullets must not be emitted'
  )
})

test('buildLarkAlertCard: runUrl rendered as primary action button', () => {
  const card = buildLarkAlertCard({
    type: '测试',
    subtitle: 's',
    runUrl: 'https://github.com/foo/bar/actions/runs/123',
  })
  // div + hr + action
  assert.equal(card.card.elements.length, 3)
  const actionEl = card.card.elements[2] as {
    actions: Array<{ url: string; type: string; text: { content: string } }>
  }
  assert.equal(actionEl.actions[0].type, 'primary')
  assert.equal(
    actionEl.actions[0].url,
    'https://github.com/foo/bar/actions/runs/123'
  )
  assert.ok(actionEl.actions[0].text.content.includes('GitHub Actions'))
})

test('buildLarkAlertCard: no runUrl → no action button (just body)', () => {
  const card = buildLarkAlertCard({ type: '测试', subtitle: 's' })
  assert.equal(card.card.elements.length, 1)
})

test('buildLarkAlertCard: empty subtitle falls back to placeholder', () => {
  const card = buildLarkAlertCard({ type: '测试', subtitle: '   ' })
  const body = card.card.elements[0] as { text: { content: string } }
  assert.ok(body.text.content.includes('请查看详情'))
})

test('sendLarkCard: 200 + non-zero code returns not-ok (signature failure mode)', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => '{"code":19021,"msg":"sign match fail"}',
  })) as unknown as typeof globalThis.fetch
  try {
    const res = await sendLarkCard(
      'https://open.feishu.cn/open-apis/bot/v2/hook/fake',
      buildLarkCard('2026-06-16', SAMPLE_BULLETS, SAMPLE_TOP)
    )
    assert.equal(res.ok, false)
    assert.ok(
      res.message.includes('sign'),
      'message should surface why the bot rejected'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
