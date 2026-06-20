// scripts/process-sample.ts — Dry-run 校验 builder 内容的 LLM 打分分布。
//
// 不写库。从 follow-builders feed 拉一份样本，喂给现有 process 阶段的
// LLM 打分函数，把 importance_score / category / summary_zh 输出到
// markdown 报告供人工 review。
//
// 用途：上线前确认中文 prompt 处理英文 builder 内容时打分分布合理
// （3-9 分散，不全 5-6 或全 1-3）。

import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import {
  transformTweets,
  transformPodcasts,
  transformBlogs,
} from '../lib/crawlers/follow-builders'
import { processArticle } from '../lib/processor/llm'

const FEED_BASE = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main'
const SAMPLE_SIZE_PER_KIND = 7  // 7 推 + 7 播客 + 几个博客 ≈ 20+ 总样本

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json() as T
}

// 根据 source_name 前缀推断 sourceCategory（同 SOURCE_CONFIGS.category 枚举）
function inferSourceCategory(sourceName: string): string {
  if (sourceName.startsWith('X:')) return 'person'
  if (sourceName.startsWith('Blog:')) return 'official'
  if (sourceName.startsWith('Podcast:')) return 'media'
  return 'media'
}

async function main(): Promise<void> {
  console.warn('[dry-run] Fetching feeds...')
  const [xFeed, podFeed, blogFeed] = await Promise.all([
    fetchJson<never>(`${FEED_BASE}/feed-x.json`),
    fetchJson<never>(`${FEED_BASE}/feed-podcasts.json`),
    fetchJson<never>(`${FEED_BASE}/feed-blogs.json`),
  ])

  const tweets = transformTweets(xFeed).slice(0, SAMPLE_SIZE_PER_KIND)
  const podcasts = transformPodcasts(podFeed).slice(0, SAMPLE_SIZE_PER_KIND)
  const blogs = transformBlogs(blogFeed).slice(0, SAMPLE_SIZE_PER_KIND)
  const samples = [...tweets, ...podcasts, ...blogs]

  console.warn(`[dry-run] Sample size: ${samples.length} (${tweets.length} tweets + ${podcasts.length} podcasts + ${blogs.length} blogs)`)

  const results: Array<{
    source_name: string
    title: string
    score: number | null
    category: string | null
    summary_zh: string | null
    error?: string
  }> = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    console.warn(`[dry-run] [${i + 1}/${samples.length}] processing: ${s.source_name} · ${s.title.slice(0, 50)}`)
    try {
      const sourceCategory = inferSourceCategory(s.source_name)
      // processArticle 签名: (title: string, content: string, sourceCategory: string)
      // 返回: { result: LLMResult; modelUsed: string }
      // LLMResult: { summary_zh, category, importance_score, why_it_matters, tags }
      const { result } = await processArticle(
        s.title,
        s.content || s.title,
        sourceCategory
      )
      results.push({
        source_name: s.source_name,
        title: s.title.slice(0, 80),
        score: result.importance_score,
        category: result.category,
        summary_zh: result.summary_zh,
      })
    } catch (err) {
      results.push({
        source_name: s.source_name,
        title: s.title.slice(0, 80),
        score: null, category: null, summary_zh: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 生成 markdown 报告
  const histogram = new Map<number, number>()
  for (const r of results) {
    if (r.score !== null) histogram.set(r.score, (histogram.get(r.score) || 0) + 1)
  }
  const histLines: string[] = []
  for (let s = 1; s <= 10; s++) {
    const n = histogram.get(s) || 0
    histLines.push(`- **${s}** ${'█'.repeat(n)} (${n})`)
  }

  const errorCount = results.filter(r => r.score === null).length

  const md = `# Follow-Builders Dry-Run Report

Generated: ${new Date().toISOString()}
Sample size: ${results.length} (${tweets.length} tweets + ${podcasts.length} podcasts + ${blogs.length} blogs)
Errors: ${errorCount}

## Importance Score Distribution

${histLines.join('\n')}

## Verdict 判断标准

- ✅ **健康**: 分数 3-9 分散，多数落在 5-7
- ⚠️ **偏低**: > 50% 落在 1-4 → 改 digest.ts 查询给 builder 单独阈值（>= 4）
- ❌ **极差**: > 80% 落在 1-2 → 改 process prompt 重跑 dry-run

## Sample Results

| # | Source | Title | Score | Category | Summary (zh) |
|---|--------|-------|-------|----------|--------------|
${results.map((r, i) =>
  `| ${i + 1} | ${r.source_name} | ${r.title.replace(/\|/g, '\\|')} | ${r.score ?? 'ERROR'} | ${r.category ?? '—'} | ${(r.summary_zh ?? r.error ?? '').slice(0, 100).replace(/\|/g, '\\|')} |`
).join('\n')}
`

  await writeFile('/tmp/fb-dry-run-report.md', md, 'utf-8')
  console.warn('[dry-run] Report written to /tmp/fb-dry-run-report.md')
  console.warn('[dry-run] Open with: open /tmp/fb-dry-run-report.md')
}

main().catch(err => {
  console.error('[dry-run] Fatal:', err)
  process.exit(1)
})
