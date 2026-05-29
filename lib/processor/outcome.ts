// ======================================================
// Process-run outcome logic (pure, side-effect free)
// ------------------------------------------------------
// Decides what counts as a genuine failure and whether a
// scheduled `process` run should alarm (non-zero exit →
// GitHub Actions failure email). Transient causes — LLM
// quota exhaustion and already-processed duplicates — are
// folded out by the callers and never alarm.
// ======================================================

// Postgres unique_violation. On processed_articles this means the
// article was already processed (its row exists); the only thing
// out of sync is the articles.is_processed flag. Benign.
const PG_UNIQUE_VIOLATION = '23505'

export function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
}

interface NewPassResult {
  processed: number
  failed: number
}

interface ReprocessPassResult {
  reprocessed: number
  failed: number
}

export interface ProcessRunSummary {
  newPass: NewPassResult
  reprocessPass: ReprocessPassResult
}

// Alarm only when the run is systemically broken: both passes did
// zero useful work AND hit genuine (non-transient) failures. A single
// pass failing, a pure-quota day, or a resolved duplicate must not
// alarm — those either self-heal or still keep the site fresh.
export function shouldAlarmProcessRun(summary: ProcessRunSummary): boolean {
  const newPassDead = summary.newPass.processed === 0 && summary.newPass.failed > 0
  const reprocessDead =
    summary.reprocessPass.reprocessed === 0 && summary.reprocessPass.failed > 0
  return newPassDead && reprocessDead
}
