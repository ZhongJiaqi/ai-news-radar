// scripts/digest.ts — Standalone daily digest script for GitHub Actions.
//
// Triggers:
// - schedule cron (23:07 UTC) — daily safety net.
// - workflow_dispatch — manual, optionally with `date` override; always regenerates.
// - workflow_run on "Process Articles" completed — event-driven catch-up so a
//   delayed cron can't leave today's briefing on the hard-fallback paragraph.
//
// To keep the workflow_run path cheap, this script skips regeneration when
// today's row is already "usable" (real multi-bullet summary + non-empty
// top_article_ids). FORCE_DIGEST=true bypasses the skip; passing an explicit
// date argument also bypasses (manual override).

import 'dotenv/config'
import { generateDailyDigest } from '../lib/processor/digest'
import { getTodayCN } from '../lib/utils/time'
import { isUsableSummary } from '../lib/utils/digestSummary'
import { createServiceClient } from '../lib/supabase'
import { pushLarkDigest } from '../lib/notify/lark'

async function isAlreadyFinalized(date: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('daily_digests')
    .select('top_article_ids, stats')
    .eq('date', date)
    .maybeSingle()
  if (error) {
    console.warn(`[Digest] Check existing row failed (non-fatal): ${error.message}`)
    return false
  }
  if (!data) return false
  const stats = data.stats as { summary_top8?: string | null } | null
  const ids = (data.top_article_ids as string[] | null) || []
  return isUsableSummary(stats?.summary_top8) && ids.length > 0
}

async function main() {
  const overrideDate = process.argv[2]
  const date = overrideDate || getTodayCN()
  const force = process.env.FORCE_DIGEST === 'true' || Boolean(overrideDate)

  if (!force && (await isAlreadyFinalized(date))) {
    console.log(`[Digest] ${date} already finalized (usable summary + IDs present), skipping.`)
    process.exit(0)
  }

  console.log(`[Digest] Generating for ${date}${force ? ' (force)' : ''}...`)
  const md = await generateDailyDigest(date)
  console.log(`[Digest] Done (${md.length} chars)`)

  // Push to Lark only after a fresh generate. The idempotent-skip path
  // above already exited before we got here, so we never double-send
  // when process->workflow_run fires multiple times the same day.
  // LARK_WEBHOOK_URL unset → silently skipped inside pushLarkDigest.
  // Best-effort: any failure inside pushLarkDigest is caught and logged,
  // never reaches us, so it can't fail the digest job.
  // Build the GH Actions run URL so the alert card (if any) can deep-link
  // back to the failing job. Undefined when running locally.
  const ghServer = process.env.GITHUB_SERVER_URL
  const ghRepo = process.env.GITHUB_REPOSITORY
  const ghRunId = process.env.GITHUB_RUN_ID
  const runUrl =
    ghServer && ghRepo && ghRunId
      ? `${ghServer}/${ghRepo}/actions/runs/${ghRunId}`
      : undefined

  try {
    await pushLarkDigest(
      createServiceClient(),
      date,
      process.env.LARK_WEBHOOK_URL,
      runUrl
    )
  } catch (err) {
    console.warn(
      `[Digest] Lark push wrapper threw (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    )
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('[Digest] Fatal error:', err)
  process.exit(1)
})
