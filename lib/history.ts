// ======================================================
// AI Radar - History reading-pane data layer
// A digest dated D covers articles published in the prior
// Beijing day [D-1 00:00, D 00:00). Mirrors digest.ts.
// ======================================================

import { createPublicClient } from './supabase'
import { queryWithRetry, isNoRowsError } from './db'
import { getDateRangeCN } from './utils/time'
import { categoryLabel } from './i18n/categories'
import { pangu } from './utils/pangu'
import type { EnrichedArticle, ContentCategory } from './types'

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export function weekdayEN(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return ''
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export interface HistoryArticle {
  id: string
  score: number
  source: string
  url: string
  title: string
  summary: string
  why: string
}

export interface HistoryCategory {
  slug: ContentCategory
  zh: string
  en: string
  items: HistoryArticle[]
}

export interface HistoryDay {
  date: string
  weekday: string
  total: number
  lede: string
  copyText: string
  categories: HistoryCategory[]
}

/** UTC range of the prior Beijing day, which a digest dated `date` covers. */
function windowForDate(date: string): { since: string; until: string } {
  const [y, m, d] = date.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  const prevStr = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`
  return getDateRangeCN(prevStr)
}

/** Pull the 今日总结 block out of a digest markdown and flatten to one paragraph. */
function extractLede(contentMd: string): string {
  const start = contentMd.indexOf('## 今日总结')
  if (start === -1) return ''
  const end = contentMd.indexOf('\n## ', start + 1)
  const text = (end === -1 ? contentMd.slice(start) : contentMd.slice(start, end))
    .replace('## 今日总结', '')
    .trim()
  const points = text
    .split('\n')
    .map(l => l.replace(/^[-•]\s*/, '').trim())
    .filter(l => l.length > 10)

  // Accumulate whole points up to ~300 chars — never cut mid-sentence,
  // so the lede stays semantically complete. The first point is always kept.
  const LEDE_MAX = 300
  let lede = ''
  for (const p of points) {
    if (lede.length > 0 && lede.length + p.length > LEDE_MAX) break
    lede += p
  }
  return lede
}

/** Discriminated result so callers can tell a transient query failure apart
 * from a genuinely missing digest, and render an honest message either way. */
export type HistoryResult =
  | { status: 'ok'; day: HistoryDay }
  | { status: 'notfound' }
  | { status: 'error' }

/**
 * Build the structured reading-pane data for a given digest date.
 * - 'notfound': no digest row exists for that date
 * - 'error': a query failed after retries (distinct from notfound)
 */
export async function getHistoryDay(date: string): Promise<HistoryResult> {
  const supabase = createPublicClient()

  const digestRes = await queryWithRetry(() =>
    supabase
      .from('daily_digests')
      .select('date, content_md, stats')
      .eq('date', date)
      .single()
  )
  if (digestRes.error) {
    return isNoRowsError(digestRes.error) ? { status: 'notfound' } : { status: 'error' }
  }
  const digest = digestRes.data as { content_md: string; stats: { total?: number } } | null
  if (!digest) return { status: 'notfound' }

  const total = digest.stats?.total ?? 0
  const lede = pangu(extractLede(digest.content_md || ''))

  const { since, until } = windowForDate(date)
  const rowsRes = await queryWithRetry(() =>
    supabase
      .from('enriched_articles')
      .select('*')
      .gte('published_at', since)
      .lt('published_at', until)
      .gte('importance_score', 5)
      .order('importance_score', { ascending: false })
      .limit(50)
  )
  if (rowsRes.error) return { status: 'error' }

  const articles = (rowsRes.data || []) as EnrichedArticle[]

  // Group by content category, preserving score order within each group.
  const groups = new Map<ContentCategory, HistoryArticle[]>()
  for (const a of articles) {
    const item: HistoryArticle = {
      id: a.id,
      score: a.importance_score,
      source: a.source_name,
      url: a.url,
      title: pangu(a.title),
      summary: pangu(a.summary_zh),
      why: a.why_it_matters?.includes('暂时无法获取') ? '' : pangu(a.why_it_matters || ''),
    }
    const arr = groups.get(a.content_category) || []
    arr.push(item)
    groups.set(a.content_category, arr)
  }

  // Richest category first → becomes the default active tab.
  const categories: HistoryCategory[] = [...groups.entries()]
    .map(([slug, items]) => ({
      slug,
      zh: categoryLabel(slug, 'zh'),
      en: categoryLabel(slug, 'en'),
      items,
    }))
    .sort((a, b) => b.items.length - a.items.length)

  return {
    status: 'ok',
    day: {
      date,
      weekday: weekdayEN(date),
      total,
      lede,
      copyText: digest.content_md || '',
      categories,
    },
  }
}
