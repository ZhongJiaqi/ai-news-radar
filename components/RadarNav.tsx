import Link from 'next/link'
import type { ReactNode } from 'react'

const GREEN = '#5FE3A1'

function RadarLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="2" fill={GREEN} stroke="none" />
      <path d="M4.93 4.93a10 10 0 0 0 0 14.14" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M7.76 7.76a6 6 0 0 0 0 8.49" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
    </svg>
  )
}

interface Props {
  active: 'news' | 'history'
  status: ReactNode
}

export default function RadarNav({ active, status }: Props) {
  return (
    <nav className="radar-nav">
      <Link href="/digest" className="radar-brand">
        <RadarLogo />
        <span className="wm">AI Radar</span>
      </Link>
      <div className="radar-navlinks">
        <Link href="/digest" className={active === 'news' ? 'on' : undefined}>News</Link>
        <Link href="/history" className={active === 'history' ? 'on' : undefined}>History</Link>
      </div>
      <div className="radar-live">
        <span className="radar-blip" aria-hidden />
        {status}
      </div>
    </nav>
  )
}
