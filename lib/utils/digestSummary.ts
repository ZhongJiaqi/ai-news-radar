// Shared "usable summary" predicate. Reused by:
// - app/digest/page.tsx — to decide whether today's row renders directly
//   or the page falls back to the most recent finalized briefing.
// - scripts/digest.ts — to decide whether a workflow_run-triggered
//   re-run should skip (row already good) or regenerate (row missing
//   or only contains the hard-fallback single-paragraph summary).

const MIN_BULLET_CHARS = 10
const MAX_BULLETS = 4

export function summaryLines(raw: string): string[] {
  return raw
    .split('\n')
    .filter((l) => l.trim().length > MIN_BULLET_CHARS)
    .slice(0, MAX_BULLETS)
}

export function isUsableSummary(raw: string | null | undefined): boolean {
  if (!raw) return false
  return summaryLines(raw).length >= 2
}
