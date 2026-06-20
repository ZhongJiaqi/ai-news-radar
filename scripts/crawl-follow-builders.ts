// scripts/crawl-follow-builders.ts — 拉 zarazhangrui/follow-builders 3 份 JSON feed
// 写入 articles 表。靠 url UNIQUE 自动去重，靠现有 process / digest cron 链
// 自然 pick up 新文章。
//
// 触发：
// - schedule cron 每天 10:00 UTC (.github/workflows/follow-builders.yml)
// - workflow_dispatch 手动
// - 本地 `npx tsx scripts/crawl-follow-builders.ts`

import 'dotenv/config'
import { createServiceClient } from '../lib/supabase'
import {
  transformTweets,
  transformPodcasts,
  transformBlogs,
  type ArticleInput,
} from '../lib/crawlers/follow-builders'

const FEED_BASE = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main'

interface FeedConfig {
  kind: 'x' | 'podcasts' | 'blogs'
  url: string
  transform: (json: unknown) => ArticleInput[]
}

const FEEDS: FeedConfig[] = [
  { kind: 'x',        url: `${FEED_BASE}/feed-x.json`,        transform: (j) => transformTweets(j as never) },
  { kind: 'podcasts', url: `${FEED_BASE}/feed-podcasts.json`, transform: (j) => transformPodcasts(j as never) },
  { kind: 'blogs',    url: `${FEED_BASE}/feed-blogs.json`,    transform: (j) => transformBlogs(j as never) },
]

const FRESHNESS_THRESHOLD_HOURS = 36

async function fetchFeedJson(url: string): Promise<{ json: unknown; generatedAt?: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json() as { generatedAt?: string }
  return { json, generatedAt: json.generatedAt }
}

async function upsertArticles(rows: ArticleInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = createServiceClient()
  // 拿对应 sources.id（已 migration 插入 3 行，按 slug 查）
  const slugs = [...new Set(rows.map(r => r.source_slug))]
  const { data: sources, error: srcErr } = await supabase
    .from('sources')
    .select('id, slug')
    .in('slug', slugs)
  if (srcErr) throw new Error(`load sources: ${srcErr.message}`)
  const slugToId = new Map<string, string>()
  for (const s of sources || []) slugToId.set(s.slug as string, s.id as string)

  const payload = rows.map(r => ({
    source_id: slugToId.get(r.source_slug) ?? null,
    source_slug: r.source_slug,
    source_name: r.source_name,
    title: r.title,
    url: r.url,
    content: r.content,
    author: r.author,
    published_at: r.published_at,
    is_active: r.is_active,
  }))

  // onConflict url do nothing — feed-podcasts 14 天 lookback 老内容会重复拉
  const { error, count } = await supabase
    .from('articles')
    .upsert(payload, { onConflict: 'url', ignoreDuplicates: true, count: 'exact' })
  if (error) throw new Error(`upsert: ${error.message}`)
  return count ?? 0
}

async function main(): Promise<void> {
  let failures = 0
  let totalInserted = 0

  for (const f of FEEDS) {
    try {
      const { json, generatedAt } = await fetchFeedJson(f.url)

      // freshness check（spec §12 edge case）
      if (generatedAt) {
        const ageHours = (Date.now() - new Date(generatedAt).getTime()) / 3_600_000
        if (ageHours > FRESHNESS_THRESHOLD_HOURS) {
          console.warn(
            `[fb-crawler] ${f.kind} feed is ${ageHours.toFixed(1)}h old (> ${FRESHNESS_THRESHOLD_HOURS}h), may be stale`
          )
        }
      }

      const rows = f.transform(json)
      const inserted = await upsertArticles(rows)
      totalInserted += inserted
      console.warn(`[fb-crawler] ${f.kind}: parsed ${rows.length} rows, upserted ${inserted}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[fb-crawler] ${f.kind} failed: ${msg}`)
      failures++
    }
  }

  console.warn(`[fb-crawler] Done. ${FEEDS.length - failures}/${FEEDS.length} feeds OK, ${totalInserted} new articles`)

  if (failures === FEEDS.length) {
    console.error('[fb-crawler] all feeds failed — exiting 1 (will trigger Lark alert)')
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('[fb-crawler] Fatal error:', err)
  process.exit(1)
})
