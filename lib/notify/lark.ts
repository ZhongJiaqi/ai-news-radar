// Lark (Feishu) interactive card delivery for the daily digest.
//
// Posts a single card to a webhook bot configured by the user (free,
// per-group). The cron pushes after generateDailyDigest writes the row,
// re-reading from Supabase so the card matches exactly what /digest will
// render (single source of truth).
//
// IMPORTANT — bot configuration on Feishu:
//   - "Signature verification" MUST stay off (this client doesn't sign).
//   - Use the "keyword" filter set to "Radar" so it matches both the
//     legacy "AI Radar" and the current "AI News Radar" wording.
// See HANDOFF for the 2026-06-15 fund-signal-monitor signature incident.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isUsableSummary } from '../utils/digestSummary'

// Score → emoji aligned with lib/processor/digest.ts SCORE_LABEL so the
// Lark card matches what the web archive shows.
function scoreEmoji(score: number | undefined): string {
  if (typeof score !== 'number') return ''
  if (score >= 9) return '🔴'
  if (score >= 7) return '🟠'
  if (score >= 5) return '🟡'
  return '⚪'
}

export interface LarkTopStory {
  title: string
  url: string
  source?: string
  score?: number
}

export interface LarkCard {
  msg_type: 'interactive'
  card: {
    config: { wide_screen_mode: boolean }
    header: {
      title: { tag: 'plain_text'; content: string }
      template: string
    }
    elements: unknown[]
  }
}

const DIGEST_URL = 'https://ai-radar-delta.vercel.app/digest'
const MAX_BULLETS = 4
const MAX_TOP_STORIES = 3

export function buildLarkCard(
  date: string,
  bullets: string[],
  topStories: LarkTopStory[]
): LarkCard {
  const bulletLines = bullets
    .slice(0, MAX_BULLETS)
    .map((b, i) => `**${i + 1}.** ${b.trim()}`)
    .join('\n\n')

  const topLines = topStories
    .slice(0, MAX_TOP_STORIES)
    .map((s) => {
      const emoji = scoreEmoji(s.score)
      const score = typeof s.score === 'number' ? ` · ${emoji} ${s.score}` : ''
      const src = s.source ? ` · ${s.source}` : ''
      return `📰 [${s.title}](${s.url})${src}${score}`
    })
    .join('\n')

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🛰 AI News Radar · ${date}` },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**今日要点**\n\n${bulletLines || '_暂无要点_'}`,
          },
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**Top Stories**\n\n${topLines || '_暂无头条_'}`,
          },
        },
        { tag: 'hr' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看完整简报' },
              type: 'primary',
              url: DIGEST_URL,
            },
          ],
        },
      ],
    },
  }
}

export interface LarkSendResult {
  ok: boolean
  status: number
  message: string
}

export async function sendLarkCard(
  webhookUrl: string,
  card: LarkCard
): Promise<LarkSendResult> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  })
  const text = await res.text()
  let parsed: {
    StatusCode?: number
    StatusMessage?: string
    code?: number
    msg?: string
  } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    // Some misconfigurations return HTML; leave parsed empty.
  }
  // Lark webhook returns either {StatusCode,StatusMessage} (legacy) or
  // {code,msg} (newer format). 0 = success.
  const code = parsed.code ?? parsed.StatusCode ?? -1
  const message = parsed.msg ?? parsed.StatusMessage ?? text.slice(0, 200)
  return { ok: res.ok && code === 0, status: res.status, message }
}

// Reads the daily_digests row + the top 3 enriched_articles for that
// day, then sends a Lark card. webhookUrl='DRY_RUN' prints the card
// JSON instead of POSTing (used for the local preview).
export async function pushLarkDigest(
  supabase: SupabaseClient,
  date: string,
  webhookUrl: string | undefined
): Promise<void> {
  if (!webhookUrl) {
    console.log('[Lark] LARK_WEBHOOK_URL not set, skipping push')
    return
  }

  const { data: row, error: rowErr } = await supabase
    .from('daily_digests')
    .select('date, top_article_ids, stats')
    .eq('date', date)
    .maybeSingle()
  if (rowErr || !row) {
    console.warn(
      `[Lark] Failed to load digest row for ${date}: ${rowErr?.message || 'row not found'}`
    )
    return
  }

  const summaryTop8 =
    (row.stats as { summary_top8?: string } | null)?.summary_top8 || ''

  // Skip when the row is a hard-fallback single paragraph or simply
  // empty. /digest itself degrades to the most recent finalized
  // briefing in that case; a Lark card with one giant blob would be
  // worse than no card at all.
  if (!isUsableSummary(summaryTop8)) {
    console.log(
      `[Lark] ${date} summary is hard-fallback or empty, skipping push`
    )
    return
  }

  const bullets = summaryTop8
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10)
    .slice(0, MAX_BULLETS)

  const topIds = ((row.top_article_ids as string[] | null) || []).slice(
    0,
    MAX_TOP_STORIES
  )
  let topStories: LarkTopStory[] = []
  if (topIds.length > 0) {
    const { data: arts } = await supabase
      .from('enriched_articles')
      .select('id, title, url, source_name, importance_score')
      .in('id', topIds)
    const map = new Map(
      (arts || []).map((a) => [a.id as string, a as Record<string, unknown>])
    )
    topStories = topIds
      .map((id) => map.get(id))
      .filter((a): a is Record<string, unknown> => Boolean(a))
      .map((a) => ({
        title: a.title as string,
        url: a.url as string,
        source: (a.source_name as string) || undefined,
        score:
          typeof a.importance_score === 'number'
            ? (a.importance_score as number)
            : undefined,
      }))
  }

  const card = buildLarkCard(date, bullets, topStories)

  if (webhookUrl === 'DRY_RUN') {
    console.log('[Lark] DRY_RUN — would POST this card:')
    console.log(JSON.stringify(card, null, 2))
    return
  }

  try {
    const result = await sendLarkCard(webhookUrl, card)
    if (result.ok) {
      console.log(`[Lark] Card sent (http=${result.status})`)
    } else {
      console.warn(
        `[Lark] Send failed (http=${result.status}): ${result.message}`
      )
    }
  } catch (err) {
    console.warn(
      `[Lark] Send threw (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
