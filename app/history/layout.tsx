import { createPublicClient } from '@/lib/supabase'
import RadarNav from '@/components/RadarNav'
import HistoryRail from '@/components/HistoryRail'

export const dynamic = 'force-dynamic'

export default async function HistoryLayout({ children }: { children: React.ReactNode }) {
  const supabase = createPublicClient()
  const { data: digests } = await supabase
    .from('daily_digests')
    .select('date, stats')
    .order('date', { ascending: false })
    .limit(7)

  const entries = (digests || []).map(d => ({
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
          <RadarNav active="history" status={<span className="stamp mono">ARCHIVE · {entries.length} DAYS</span>} />

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
