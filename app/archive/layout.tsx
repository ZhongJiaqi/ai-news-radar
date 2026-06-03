import { createPublicClient } from '@/lib/supabase'
import { queryWithRetry } from '@/lib/db'
import RadarNav from '@/components/RadarNav'
import HistoryRail from '@/components/HistoryRail'

// ISR — rail data changes at most once per day when a new digest lands.
// `force-dynamic` here cascades to /archive/[date] and silently disables
// that page's own revalidate, so every request is a full SSR (~2-3s).
// 1h staleness on the rail is fine for a once-a-day product.
export const revalidate = 3600

interface DigestRow { date: string; stats: { total?: number } | null }

export default async function HistoryLayout({ children }: { children: React.ReactNode }) {
  const supabase = createPublicClient()
  const { data: digests } = await queryWithRetry(() =>
    supabase
      .from('daily_digests')
      .select('date, stats')
      .order('date', { ascending: false })
      .limit(7)
  )

  const entries = ((digests as DigestRow[] | null) || []).map(d => ({
    date: d.date,
    total: d.stats?.total || 0,
  }))

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .root-nav { display: none !important; }
        .root-footer { display: none !important; }
        .root-main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
      `}} />
      <div className="radar">
        <div className="radar-shell">
          <RadarNav active="archive" status={<span className="stamp mono">ARCHIVE · {entries.length} DAYS</span>} />

          <div className="radar-archive">
            <HistoryRail entries={entries} />
            <main className="radar-read">
              {children}
            </main>
          </div>

          <footer className="radar-foot">
            <span className="mono">AI News — Daily AI Briefing</span>
          </footer>
        </div>
      </div>
    </>
  )
}
