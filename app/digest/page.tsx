import { createPublicClient } from '@/lib/supabase'
import { getTodayCN } from '@/lib/utils/time'
import type { EnrichedArticle, DigestStats } from '@/lib/types'
import DemoClient from './DemoClient'

export const revalidate = 60

// Page needs 8 articles (3 Top + 5 More).
const PAGE_DISPLAY_LIMIT = 8
// How far back to look for a usable finalized briefing when today's
// row is missing or only contains the hard-fallback summary.
const FALLBACK_LOOKBACK_DAYS = 7

function summaryLines(raw: string): string[] {
  return raw.split('\n').filter((l: string) => l.trim().length > 10).slice(0, 4)
}

/**
 * A briefing row is "usable" only when its summary survived the LLM call
 * and got split into real bullet points. When the LLM timed out the cron
 * writes a hard-fallback single paragraph ("今日共收录 N 条 AI 资讯。
 * 重点包括：..."), which would render as one giant SIG card — uglier
 * than showing yesterday's finalized briefing.
 */
function isUsableSummary(raw: string | null | undefined): boolean {
  if (!raw) return false
  return summaryLines(raw).length >= 2
}

type DigestRow = {
  date: string
  stats: DigestStats | null
  top_article_ids: string[] | null
}

async function loadRowArticles(
  supabase: ReturnType<typeof createPublicClient>,
  row: DigestRow
): Promise<EnrichedArticle[]> {
  const ids = (row.top_article_ids || []).slice(0, PAGE_DISPLAY_LIMIT)
  if (ids.length === 0) return []
  const byIdRes = await supabase
    .from('enriched_articles')
    .select('*')
    .in('id', ids)
  const fetched = (byIdRes.data || []) as EnrichedArticle[]
  const order = new Map(ids.map((id, i) => [id, i]))
  return fetched
    .filter(a => order.has(a.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

async function getData() {
  const supabase = createPublicClient()
  const today = getTodayCN()

  // Pull today's row plus the last week of fallback candidates in one
  // query. The cron sometimes lands today's row first with a broken
  // summary, so we always want a few finalized rows on hand to degrade
  // to without re-querying.
  const cutoff = new Date(today + 'T00:00:00Z')
  cutoff.setUTCDate(cutoff.getUTCDate() - FALLBACK_LOOKBACK_DAYS)
  const { data: recentRaw } = await supabase
    .from('daily_digests')
    .select('date, stats, top_article_ids')
    .gte('date', cutoff.toISOString().slice(0, 10))
    .lte('date', today)
    .order('date', { ascending: false })

  const recent = (recentRaw || []) as DigestRow[]
  const todayRow = recent.find(r => r.date === today) || null
  const todayUsable =
    !!todayRow &&
    isUsableSummary(todayRow.stats?.summary_top8) &&
    (todayRow.top_article_ids?.length || 0) > 0

  let chosen: DigestRow | null = todayUsable ? todayRow : null
  let pendingReason: 'cron-pending' | 'cron-degraded' | null = null

  if (!chosen) {
    // Degrade to the most recent finalized briefing. Showing yesterday's
    // good content with a clear "today's briefing is generating" badge
    // beats rendering today's date over a hard-fallback paragraph.
    chosen = recent.find(
      r =>
        r.date !== today &&
        isUsableSummary(r.stats?.summary_top8) &&
        (r.top_article_ids?.length || 0) > 0
    ) || null
    pendingReason = todayRow ? 'cron-degraded' : 'cron-pending'
  }

  if (!chosen) {
    return { articles: [], summary: [], digestDate: today, pendingReason: 'cron-pending' as const }
  }

  const articles = await loadRowArticles(supabase, chosen)
  const summary = summaryLines(chosen.stats?.summary_top8 || '')

  return {
    articles,
    summary,
    digestDate: chosen.date,
    pendingReason,
  }
}

export default async function DemoPage() {
  const data = await getData()
  return <DemoClient {...data} />
}
