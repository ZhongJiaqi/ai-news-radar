import { createPublicClient } from '@/lib/supabase'
import { getYesterdayRangeCN, getTodayCN } from '@/lib/utils/time'
import { generateDailyDigest } from '@/lib/processor/digest'
import type { EnrichedArticle } from '@/lib/types'
import DemoClient from './DemoClient'

export const revalidate = 60

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
  const { since, until } = getYesterdayRangeCN()
  const today = getTodayCN()

  // 查询昨天一整天（北京时间）的文章
  const articlesRes = await supabase
    .from('enriched_articles')
    .select('*')
    .gte('published_at', since)
    .lt('published_at', until)
    .gte('importance_score', 5)
    .order('importance_score', { ascending: false })
    .limit(8)

  const articles = (articlesRes.data || []) as EnrichedArticle[]

  // 查缓存：今天的 digest（覆盖昨天的文章）
  const { data: cached } = await supabase
    .from('daily_digests')
    .select('date, content_md, stats')
    .eq('date', today)
    .single()

  let summary: string[] = []

  if (cached?.content_md) {
    summary = extractSummary(cached.content_md)
  }

  // 缓存不存在或摘要提取失败，实时生成完整 digest
  if (summary.length === 0 && articles.length > 0) {
    try {
      const fullMd = await generateDailyDigest(today)
      summary = extractSummary(fullMd)
    } catch (err) {
      console.warn('[Digest] Real-time digest generation failed:', err)
    }
  }

  return {
    articles,
    summary,
    digestDate: today,
  }
}

export default async function DemoPage() {
  const data = await getData()
  return <DemoClient {...data} />
}
