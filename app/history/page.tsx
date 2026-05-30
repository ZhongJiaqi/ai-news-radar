import { redirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function HistoryIndex() {
  const supabase = createPublicClient()
  const { data } = await supabase
    .from('daily_digests')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single()

  if (data?.date) redirect(`/history/${data.date}`)

  return (
    <div className="radar-read-inner">
      <div className="radar-empty">
        <div className="e1">暂无归档</div>
        <div className="e2 mono">No Archive Yet</div>
      </div>
    </div>
  )
}
