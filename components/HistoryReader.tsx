'use client'

import { useState } from 'react'
import type { HistoryDay } from '@/lib/history'

interface Props {
  day: HistoryDay
}

export default function HistoryReader({ day }: Props) {
  const [tab, setTab] = useState(0)
  const [copied, setCopied] = useState(false)

  const hasContent = day.categories.length > 0
  const activeIndex = Math.min(tab, day.categories.length - 1)
  const cat = hasContent ? day.categories[activeIndex] : null

  function copy() {
    navigator.clipboard?.writeText(day.copyText || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="radar-read-inner">
      <div className="radar-head">
        <div className="radar-head-l">
          <span className="radar-eyebrow">Daily Briefing</span>
          <span className="radar-dstamp mono">{day.date} · {day.weekday}</span>
        </div>
        <button
          className={`radar-copy${copied ? ' done' : ''}`}
          onClick={copy}
          disabled={!day.copyText}
          title="复制本日完整日报（Markdown 格式），可直接粘到微信、Notion、邮件等地方分享"
        >
          {copied ? 'Copied' : 'Copy as Markdown'}
        </button>
      </div>

      <h1 className="radar-title">每日 AI 简报</h1>

      {hasContent ? (
        <>
          {day.lede && <p className="radar-lede">{day.lede}</p>}

          <div className="radar-seclabel">
            <span className="l">Categories</span>
            <span className="rule" />
          </div>

          <div className="radar-tabs" role="tablist">
            {day.categories.map((c, i) => (
              <button
                key={c.slug}
                role="tab"
                aria-selected={i === activeIndex}
                className={`radar-tab${i === activeIndex ? ' on' : ''}`}
                onClick={() => setTab(i)}
              >
                {c.zh}
                <span className="tc mono">{c.items.length}</span>
              </button>
            ))}
          </div>

          {cat && (
            <div key={`${day.date}-${activeIndex}`} className="radar-fade">
              {cat.items.map(a => (
                <article className="radar-art" key={a.id}>
                  <div className="am">
                    <span className="sc mono">{a.score}.0</span>
                    <span className="asrc">{a.source}</span>
                    <span className="radar-sep" aria-hidden />
                    <span className="aen">{cat.en}</span>
                  </div>
                  <h4>
                    <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                  </h4>
                  {a.summary && <p>{a.summary}</p>}
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="radar-empty">
          <div className="e1">该日归档已收录 {day.total} 条信号</div>
          <div className="e2 mono">Digest Not Expanded</div>
        </div>
      )}
    </div>
  )
}
