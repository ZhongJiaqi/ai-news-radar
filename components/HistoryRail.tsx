'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { weekdayEN } from '@/lib/history'

export interface RailEntry {
  date: string
  total: number
}

export default function HistoryRail({ entries }: { entries: RailEntry[] }) {
  const pathname = usePathname()
  const fromPath = pathname.match(/\/archive\/(\d{4}-\d{2}-\d{2})/)?.[1]
  const activeDate = fromPath || entries[0]?.date

  return (
    <aside className="radar-rail">
      <div className="radar-rail-label">Past 7 days</div>
      <nav className="radar-arc">
        {entries.map(e => (
          <Link
            key={e.date}
            href={`/archive/${e.date}`}
            className={`radar-date${e.date === activeDate ? ' on' : ''}`}
            aria-current={e.date === activeDate ? 'page' : undefined}
          >
            <div>
              <div className="dd mono">{e.date.slice(5)}</div>
              <div className="wd">{weekdayEN(e.date)}</div>
            </div>
            <span className="ct mono">{e.total}</span>
          </Link>
        ))}
      </nav>
    </aside>
  )
}
