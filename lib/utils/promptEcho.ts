// Detects an LLM copying the JSON-template placeholder text from our
// prompts back into its output instead of writing a real summary — the
// signature failure of task-unfit models (2026-07-17..22: qwen3.5-ocr
// stored "2-3 句话的中文摘要，说清楚是什么、有什么变化" as article summaries
// and it surfaced verbatim on /digest).
//
// Markers are substrings of the templates in lib/processor/llm.ts and
// lib/processor/digest.ts. They can never occur in a genuine summary.

const PROMPT_ECHO_MARKERS = [
  '句话的中文摘要',
  '说清楚是什么、有什么变化',
  '说清楚对 AI 从业者的核心影响',
] as const

export function looksLikePromptEcho(text: string | null | undefined): boolean {
  if (!text) return false
  return PROMPT_ECHO_MARKERS.some(marker => text.includes(marker))
}
