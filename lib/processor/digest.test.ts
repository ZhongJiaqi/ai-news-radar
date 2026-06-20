import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { isOfficialSource } from './digest'
import type { EnrichedArticle } from '../types'

function makeArticle(overrides: Partial<EnrichedArticle>): EnrichedArticle {
  return {
    id: 'test-id',
    source_slug: 'test',
    source_name: 'TechCrunch',
    title: 'test',
    url: 'https://test.example/1',
    author: 'test',
    published_at: '2026-06-19T00:00:00Z',
    crawled_at: '2026-06-19T00:00:00Z',
    summary_zh: '',
    content_category: '行业动态',
    tags: [],
    importance_score: 7,
    why_it_matters: '',
    processed_at: '2026-06-19T00:00:00Z',
    ...overrides,
  } as EnrichedArticle
}

test('isOfficialSource: @claudeai 是官方', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @claudeai' })), true)
})

test('isOfficialSource: @AnthropicAI / @OpenAI / @GoogleDeepMind / @GoogleLabs 是官方', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @AnthropicAI' })), true)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @OpenAI' })), true)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @GoogleDeepMind' })), true)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @GoogleLabs' })), true)
})

test('isOfficialSource: @sama / @karpathy / @swyx 是个人，不是官方', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @sama' })), false)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @karpathy' })), false)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'X: @swyx' })), false)
})

test('isOfficialSource: 所有 Blog: 都是官方', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: 'Blog: Anthropic Engineering' })), true)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'Blog: Claude' })), true)
})

test('isOfficialSource: Podcast 和 TechCrunch 等媒体不是官方', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: 'Podcast: Latent Space' })), false)
  assert.equal(isOfficialSource(makeArticle({ source_name: 'TechCrunch' })), false)
  assert.equal(isOfficialSource(makeArticle({ source_name: '36氪' })), false)
})

test('isOfficialSource: 空 source_name', () => {
  assert.equal(isOfficialSource(makeArticle({ source_name: '' })), false)
})
