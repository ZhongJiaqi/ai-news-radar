// scripts/process.ts — Standalone LLM processing script for GitHub Actions
import 'dotenv/config'
import { processUnprocessedArticles, reprocessFallbackArticles } from '../lib/processor/llm'
import { shouldAlarmProcessRun } from '../lib/processor/outcome'

async function main() {
  const batchSize = parseInt(process.env.BATCH_SIZE || '50', 10)
  const reprocessSize = parseInt(process.env.REPROCESS_BATCH_SIZE || '50', 10)

  console.log(`[Process] Starting new-article pass (batch size: ${batchSize})...`)
  const result = await processUnprocessedArticles(batchSize)
  const total = result.processed + result.failed
  const successRate = total > 0 ? Math.round((result.processed / total) * 100) : 100
  console.log(`[Process] Done: ${result.processed} processed, ${result.failed} failed (${successRate}% success rate)`)

  console.log(`[Reprocess] Starting fallback retry pass (batch size: ${reprocessSize})...`)
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
