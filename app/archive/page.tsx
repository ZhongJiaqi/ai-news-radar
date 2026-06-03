import { redirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase'
import { queryWithRetry, isNoRowsError } from '@/lib/db'

// ISR — this only queries the latest digest date and redirects. 1h
// stale is fine; the new daily date appears within an hour of cron.
export const revalidate = 3600

export default async function HistoryIndex() {
  const supabase = createPublicClient()
  const res = await queryWithRetry(() =>
    supabase
      .from('daily_digests')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()
  )

  // Query failed (after retries) — show an honest error, not "no archive".
  if (res.error && !isNoRowsError(res.error)) {
    return (
      <div className="radar-read-inner">
        <div className="radar-empty">
          <div className="e1">加载失败，请刷新重试</div>
          <div className="e2 mono">Load Failed</div>
        </div>
      </div>
    )
  }

  const date = (res.data as { date?: string } | null)?.date
  if (date) redirect(`/archive/${date}`)

  // Genuinely empty archive (no rows).
  return (
    <div className="radar-read-inner">
      <div className="radar-empty">
        <div className="e1">暂无归档</div>
        <div className="e2 mono">No Archive Yet</div>
      </div>
    </div>
  )
}
