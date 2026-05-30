import { createPublicClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { getHistoryDay } from '@/lib/history'
import HistoryReader from '@/components/HistoryReader'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

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
