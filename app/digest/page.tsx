import { createPublicClient } from '@/lib/supabase'
import { getYesterdayRangeCN, getTodayCN } from '@/lib/utils/time'
import { generateDailyDigest, deduplicateArticles } from '@/lib/processor/digest'
import type { EnrichedArticle, DigestStats } from '@/lib/types'
import DemoClient from './DemoClient'

export const revalidate = 60

// Page needs 8 articles (3 Top + 5 More).
const PAGE_DISPLAY_LIMIT = 8
// Fallback path only — wide enough that LLM dedup still leaves 8.
const PAGE_FALLBACK_FETCH = 20

function extractSummary(contentMd: string): string[] {
  const start = contentMd.indexOf('## 今日总结')
  if (start === -1) return []
  const end = contentMd.indexOf('\n## ', start + 1)
  const text = (end === -1 ? contentMd.slice(start) : contentMd.slice(start, end))
    .replace('## 今日总结', '').trim()
  return text.split('\n').filter((l: string) => l.trim().length > 10).slice(0, 4)
}

async function getData() {
  const supabase = createPublicClient()
  const today = getTodayCN()

  // Read today's cached digest first — its `top_article_ids` is the
  // dedup'd top 30 (since 2026-05-30, marked by stats.dedup_applied).
  // This is the fast path: 0 LLM calls at page render.
  const { data: cached } = await supabase
    .from('daily_digests')
    .select('date, content_md, stats, top_article_ids')
    .eq('date', today)
    .single()

  const cachedRow = cached as
    | { content_md: string | null; stats: DigestStats | null; top_article_ids: string[] | null }
    | null

  let articles: EnrichedArticle[] = []

  if (
    cachedRow?.stats?.dedup_applied &&
    cachedRow.top_article_ids &&
    cachedRow.top_article_ids.length > 0
  ) {
    // Fast path: query enriched_articles by the cron's deduped IDs.
    const ids = cachedRow.top_article_ids.slice(0, PAGE_DISPLAY_LIMIT)
    const byIdRes = await supabase
      .from('enriched_articles')
      .select('*')
      .in('id', ids)
    const fetched = (byIdRes.data || []) as EnrichedArticle[]
    // .in() doesn't preserve order — restore the cron's ranking.
    const order = new Map(ids.map((id, i) => [id, i]))
    articles = fetched
      .filter(a => order.has(a.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  if (articles.length === 0) {
    // Fallback path: cron hasn't generated today's digest yet (early
    // morning before 07:07 BJT) OR the row is an older one without
    // `dedup_applied`. Live query + dedup at render time.
    const { since, until } = getYesterdayRangeCN()
    const articlesRes = await supabase
      .from('enriched_articles')
      .select('*')
      .gte('published_at', since)
      .lt('published_at', until)
      .gte('importance_score', 5)
      .order('importance_score', { ascending: false })
      .limit(PAGE_FALLBACK_FETCH)
    const pool = (articlesRes.data || []) as EnrichedArticle[]
    const deduped = await deduplicateArticles(pool)
    articles = deduped.slice(0, PAGE_DISPLAY_LIMIT)
  }

  // Executive summary lines (今日要点 grid)
  let summary: string[] = []
  if (cachedRow?.content_md) {
    summary = extractSummary(cachedRow.content_md)
  }
  if (summary.length === 0 && articles.length > 0) {
    try {
      const fullMd = await generateDailyDigest(today)
      summary = extractSummary(fullMd)
    } catch (err) {
      console.warn('[Digest] Real-time digest generation failed:', err)
    }
  }

  return { articles, summary, digestDate: today }
}

export default async function DemoPage() {
  const data = await getData()
  return <DemoClient {...data} />
}
