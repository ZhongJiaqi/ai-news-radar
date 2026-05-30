'use client'

import Link from 'next/link'
import { pangu } from '@/lib/utils/pangu'
import { categoryLabel } from '@/lib/i18n/categories'
import type { EnrichedArticle } from '@/lib/types'
import RadarNav from '@/components/RadarNav'

const GREEN = '#5FE3A1'
const AMBER = '#E8B355'
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function timeAgo(dateStr: string): string {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000)
  if (h < 1) return '刚刚'
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return ''
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Animated radar dish in the hero. */
function RadarDish() {
  return (
    <svg className="radar-dish" viewBox="0 0 200 200" fill="none" aria-hidden>
      <defs>
        <radialGradient id="raGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0.18" />
          <stop offset="70%" stopColor={GREEN} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="raSweep" x1="100" y1="100" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0.55" />
          <stop offset="100%" stopColor={GREEN} stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="95" fill="url(#raGlow)" />
      {[30, 56, 82].map(r => <circle key={r} cx="100" cy="100" r={r} stroke="#27302E" strokeWidth="1" />)}
      <circle cx="100" cy="100" r="95" stroke="#2C3633" strokeWidth="1" />
      <line x1="5" y1="100" x2="195" y2="100" stroke="#222B29" strokeWidth="1" />
      <line x1="100" y1="5" x2="100" y2="195" stroke="#222B29" strokeWidth="1" />
      <g className="radar-scan">
        <path d="M100 100 L100 5 A95 95 0 0 1 175 45 Z" fill="url(#raSweep)" />
        <line x1="100" y1="100" x2="100" y2="5" stroke={GREEN} strokeWidth="1.5" strokeOpacity="0.8" />
      </g>
      <circle cx="138" cy="66" r="2.5" fill={GREEN} />
      <circle cx="74" cy="138" r="2" fill={AMBER} />
      <circle cx="120" cy="128" r="1.8" fill={GREEN} opacity="0.7" />
      <circle cx="100" cy="100" r="3" fill={GREEN} />
    </svg>
  )
}

interface Props {
  articles: EnrichedArticle[]
  summary: string[]
  digestDate: string | null
}

export default function DemoClient({ articles, summary, digestDate }: Props) {
  const topArticles = articles.slice(0, 3)
  const restArticles = articles.slice(3, 8)
  const dateStr = digestDate || new Date().toISOString().slice(0, 10)

  return (
    <div className="radar">
      <div className="radar-shell">
        <RadarNav active="news" status={<span className="stamp mono">{weekdayOf(dateStr)} {dateStr}</span>} />

        {/* Hero */}
        <section className="radar-hero">
          <RadarDish />
          <div className="radar-eyebrow">Daily Briefing</div>
          <div className="radar-datestamp mono">{dateStr} · 北京时间 07:07 生成</div>

          {summary.length > 0 ? (
            <div className="radar-sigs">
              {summary.map((line, i) => (
                <div className="radar-sig" key={i}>
                  <span className="radar-sig-dot" aria-hidden />
                  <div>
                    <div className="num mono">SIG·{String(i + 1).padStart(2, '0')}</div>
                    <p>{pangu(line.replace(/^[-•]\s*/, ''))}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ marginTop: 34, color: 'var(--fg2)', fontSize: 'var(--text-base)' }}>暂无数据</p>
          )}
        </section>

        {/* Top Stories */}
        {topArticles.length > 0 && (
          <section className="radar-sec">
            <div className="radar-seclabel">
              <span className="l">Top Stories</span>
              <span className="rule" />
              <span className="c mono">{String(topArticles.length).padStart(2, '0')}</span>
            </div>
            {topArticles.map(a => (
              <article className="radar-story" key={a.id}>
                <div className="radar-gutter">
                  <span className="radar-score mono">{a.importance_score}</span>
                  <span className="radar-bar" aria-hidden />
                </div>
                <div>
                  <div className="radar-meta">
                    <span className="radar-cat">{categoryLabel(a.content_category)}</span>
                    <span className="radar-src">{a.source_name}</span>
                    {a.published_at && (
                      <>
                        <span className="radar-sep" aria-hidden />
                        <span className="radar-ago mono">{timeAgo(a.published_at)}</span>
                      </>
                    )}
                  </div>
                  <h3>
                    <a href={a.url} target="_blank" rel="noopener noreferrer">{pangu(a.title)}</a>
                  </h3>
                  <p className="sum">{pangu(a.summary_zh)}</p>
                  {a.why_it_matters && !a.why_it_matters.includes('暂时无法获取') && (
                    <p className="why">▸ {pangu(a.why_it_matters)}</p>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}

        {/* More Signals */}
        {restArticles.length > 0 && (
          <section className="radar-sec">
            <div className="radar-seclabel">
              <span className="l">More Signals</span>
              <span className="rule" />
              <span className="c mono">+{restArticles.length}</span>
            </div>
            {restArticles.map((a, i) => (
              <a className="radar-mrow" key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
                <span className="idx mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="ttl">{pangu(a.title)}</span>
                <span className="rt">
                  <span className="rs">{a.source_name}</span>
                  {a.published_at && <span className="rago mono">{timeAgo(a.published_at)}</span>}
                </span>
              </a>
            ))}
            <Link className="radar-allarc mono" href="/history">查看完整归档 →</Link>
          </section>
        )}

        <footer className="radar-foot">
          <span className="mono">AI News — Daily AI Briefing</span>
        </footer>
      </div>
    </div>
  )
}
