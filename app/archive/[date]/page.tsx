import { createPublicClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { getHistoryDay } from '@/lib/history'
import HistoryReader from '@/components/HistoryReader'
import type { Metadata } from 'next'

// ISR: re-validate at most every hour. Past dates never change; today's
// page just needs to pick up new articles after process/digest cron runs
// (every 3h / daily). Caching also rides out Supabase fetch hiccups.
export const revalidate = 3600

// Next.js 15 treats dynamic-param routes as fully dynamic UNLESS
// generateStaticParams declares the prerender set. Without this, the
// `revalidate` above is silently ignored and every request becomes a
// full SSR — which is what was making /archive/<date> hang 2-3s.
// Prerender the 7 dates the History rail surfaces; anything else
// falls back to on-demand ISR (still cached, just first-hit slow).
export async function generateStaticParams() {
  const supabase = createPublicClient()
  const { data } = await supabase
    .from('daily_digests')
    .select('date')
    .order('date', { ascending: false })
    .limit(7)
  return (data ?? []).map(d => ({ date: (d as { date: string }).date }))
}

interface PageProps {
  params: Promise<{ date: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params
  const supabase = createPublicClient()
  const { data: digest } = await supabase
    .from('daily_digests')
    .select('stats')
    .eq('date', date)
    .single()

  const total = digest?.stats?.total ?? 0
  const avg = digest?.stats?.avg_importance ?? 0
  const title = `AI RADAR 日报 ${date}`
  const description = `${date} 全球 AI 动态 — ${total} 条资讯，平均重要性 ${avg}/10`

  return {
    title,
    description,
    openGraph: { title, description, type: 'article', publishedTime: `${date}T08:00:00+08:00` },
    twitter: { title, description },
  }
}

export default async function HistoryDatePage({ params }: PageProps) {
  const { date } = await params

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const result = await getHistoryDay(date)

  if (result.status === 'error') {
    return (
      <div className="radar-read-inner">
        <div className="radar-empty">
          <div className="e1">加载失败，请刷新重试</div>
          <div className="e2 mono">Load Failed</div>
        </div>
      </div>
    )
  }

  if (result.status === 'notfound') {
    return (
      <div className="radar-read-inner">
        <div className="radar-empty">
          <div className="e1">{date} 简报尚未生成</div>
          <div className="e2 mono">Digest Not Found</div>
        </div>
      </div>
    )
  }

  return <HistoryReader day={result.day} />
}
