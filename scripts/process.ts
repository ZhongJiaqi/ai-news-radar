// scripts/process.ts — Standalone LLM processing script for GitHub Actions
import 'dotenv/config'
import { processUnprocessedArticles, reprocessFallbackArticles } from '../lib/processor/llm'
import { shouldAlarmProcessRun } from '../lib/processor/outcome'
import { createServiceClient } from '../lib/supabase'
import {
  countAvailableModels,
  discoverModels,
  probeSweep,
  reviveExhaustedModels,
} from '../lib/llm/discovery'

// Trigger probe sweep when fewer known models are healthy than this.
// Healthy steady-state is ≥10; <3 means the env chain has burned through
// the per-model daily quota — DashScope counts free-tier quota per
// model ID, so newly-released model IDs in the unknown pool usually
// still have fresh buckets. The sweep promotes the first batch that
// pings 200 so the run can drain the queue with real LLM calls instead
// of falling through to the hard-fallback summary again.
const SWEEP_THRESHOLD = 3
const SWEEP_LIMIT = 30

async function warmUpModelHealth() {
  if (process.env.LLM_DYNAMIC_CHAIN === 'off') return
  const base = (process.env.LLM_BASE_URL || '').toLowerCase()
  if (!base.includes('dashscope.aliyuncs.com')) return
  try {
    const client = createServiceClient()
    const provider = 'dashscope'
    const revived = await reviveExhaustedModels(client, provider)
    if (revived > 0) console.log(`[Process] Revived ${revived} exhausted model(s)`)
    const ids = await discoverModels(
      client,
      provider,
      process.env.LLM_BASE_URL || '',
      process.env.LLM_API_KEY || ''
    )
    if (ids.length > 0) console.log(`[Process] Discovered ${ids.length} model(s) from provider`)

    const available = await countAvailableModels(client, provider)
    console.log(`[Process] ${available} model(s) currently available`)
    if (available < SWEEP_THRESHOLD) {
      console.log(`[Process] Below threshold (${SWEEP_THRESHOLD}), probing up to ${SWEEP_LIMIT} unknown model(s)...`)
      const promoted = await probeSweep(
        client,
        provider,
        process.env.LLM_BASE_URL || '',
        process.env.LLM_API_KEY || '',
        SWEEP_LIMIT
      )
      console.log(
        `[Process] Probe sweep promoted ${promoted.length} model(s)` +
          (promoted.length > 0 ? `: ${promoted.join(', ')}` : '')
      )
    }
  } catch (err) {
    console.warn('[Process] Model health warm-up skipped:', err instanceof Error ? err.message : err)
  }
}

async function main() {
  await warmUpModelHealth()

  // Drain mode: pull articles in 20-piece chunks until either the queue
  // is empty or we approach the job's wall-clock timeout. The 5-minute
  // safety margin leaves room for the reprocess pass and the job-runs
  // cleanup writes to land before the runner kills us.
  const jobBudgetMs = parseInt(process.env.JOB_BUDGET_MINUTES || '180', 10) * 60_000
  const safetyMarginMs = 5 * 60_000
  const newPassDeadline = Date.now() + (jobBudgetMs - safetyMarginMs - 5 * 60_000) // reserve 5min for reprocess
  const reprocessDeadline = Date.now() + (jobBudgetMs - safetyMarginMs)

  console.log(`[Process] Starting new-article drain pass (deadline in ${Math.round((newPassDeadline - Date.now())/60_000)}min)...`)
  const result = await processUnprocessedArticles({ deadlineMs: newPassDeadline, chunkSize: 20 })
  const total = result.processed + result.failed
  const successRate = total > 0 ? Math.round((result.processed / total) * 100) : 100
  console.log(`[Process] Done: ${result.processed} processed, ${result.failed} failed (${successRate}% success rate)`)

  // Reprocess remains small-batch — fallback rows are rare (typically <10).
  const reprocessSize = parseInt(process.env.REPROCESS_BATCH_SIZE || '50', 10)
  console.log(`[Reprocess] Starting fallback retry pass (batch size: ${reprocessSize}, deadline in ${Math.round((reprocessDeadline - Date.now())/60_000)}min)...`)
  const reprocessResult = await reprocessFallbackArticles(reprocessSize)
  console.log(`[Reprocess] Done: ${reprocessResult.reprocessed} reprocessed, ${reprocessResult.failed} failed`)

  // Alarm (non-zero exit → GitHub Actions failure email) only on a systemic
  // break: both passes did zero useful work AND hit genuine failures.
  // Transient causes — LLM quota exhaustion, already-processed duplicates —
  // are folded out upstream and exit cleanly, so the daily failure emails
  // stop firing on conditions that self-heal on the next run.
  if (shouldAlarmProcessRun({ newPass: result, reprocessPass: reprocessResult })) {
    console.error('[Process] Both passes failed for genuine reasons — exiting 1 (alarm).')
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('[Process] Fatal error:', err)
  process.exit(1)
})
