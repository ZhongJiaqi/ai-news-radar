// ======================================================
// AI Radar - LLM Processor (Generic LLM Provider)
// ======================================================

import { generateJson } from '../llm'
import { createServiceClient } from '../supabase'
import { SOURCE_CONFIGS } from '../crawlers/sources'
import { CATEGORY_LABELS } from '../i18n/categories'
import { CONTENT_CATEGORIES } from '../types'
import type { LLMResult, ContentCategory } from '../types'
import { pangu } from '../utils/pangu'
import { isDuplicateKeyError } from './outcome'

const SYSTEM_PROMPT = `你是 AI Radar 的内容分析师，专注于全球 AI 行业动态。
你的任务是分析 AI 相关文章，为中国 AI 从业者（产品经理、开发者、创业者）提取关键信息。
输出必须是严格的 JSON 格式，不得包含任何额外文字。`

// Build "slug (中文名)" list for the LLM prompt
const CATEGORY_PROMPT_LIST = CONTENT_CATEGORIES
  .map(slug => `${slug} (${CATEGORY_LABELS[slug].zh})`)
  .join(' / ')

function sanitizeContent(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .replace(/\\/g, '\\\\')  // escape backslashes
    .replace(/\u2028/g, ' ') // line separator
    .replace(/\u2029/g, ' ') // paragraph separator
    .replace(/\0/g, '')      // null bytes
}

function buildUserPrompt(title: string, content: string, sourceCategory: string): string {
  return `分析以下 AI 资讯，返回 JSON：

标题: ${sanitizeContent(title)}
来源类型: ${sourceCategory}
内容摘要: ${sanitizeContent(content.slice(0, 2000))}

返回格式（严格 JSON，不加任何其他文字）：
{
  "summary_zh": "2-3句话的中文摘要，说清楚是什么、有什么变化",
  "category": "从以下选一个英文 slug: ${CATEGORY_PROMPT_LIST}",
  "tags": ["标签1", "标签2", "标签3"],
  "importance_score": 数字1-10（10=行业级重大事件，1=一般信息），
  "why_it_matters": "一句话说清楚对 AI 从业者的核心影响或机会"
}`
}

function heuristicFallback(title: string, content: string, sourceCategory: string): LLMResult {
  const score =
    sourceCategory === 'official' ? 5
      : sourceCategory === 'person' ? 4
        : 3

  const compact = (s: string) => s.replace(/\s+/g, ' ').trim()
  const snippet = compact(sanitizeContent(content || '')).slice(0, 220)
  const summary = compact(`${title}。${snippet ? ` ${snippet}` : ''}`).slice(0, 500)

  return {
    summary_zh: summary || String(title || '').slice(0, 500),
    category: 'industry_news',
    tags: [],
    importance_score: score,
    why_it_matters: '暂时无法获取 LLM 分析结果，后续将自动补全。',
  }
}

const toErrText = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const anyErr = err as any
    if (typeof anyErr.error === 'string') return anyErr.error
    if (anyErr.error && typeof anyErr.error === 'object') {
      if (typeof anyErr.error.error === 'string') return anyErr.error.error
      if (typeof anyErr.error.message === 'string') return anyErr.error.message
    }
    if (typeof anyErr.message === 'string') return anyErr.message
  }
  return String(err)
}

export async function processArticle(
  title: string,
  content: string,
  sourceCategory: string
): Promise<{ result: LLMResult; modelUsed: string }> {
  try {
    const response = await generateJson({
      task: 'article',
      prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(title, content, sourceCategory)}`,
      maxTokens: 512,
    })

    const jsonMatch = response.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error(`LLM returned invalid JSON: ${response.text.slice(0, 200)}`)
    }

    const parsed = JSON.parse(jsonMatch[0])

    const category = CONTENT_CATEGORIES.includes(parsed.category)
      ? parsed.category as ContentCategory
      : 'industry_news'

    const score = Math.max(1, Math.min(10, Math.round(Number(parsed.importance_score) || 5)))

    return {
      modelUsed: response.modelUsed,
      result: {
        summary_zh: pangu(String(parsed.summary_zh || '').slice(0, 500)),
        category,
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.slice(0, 8).map(String)
          : [],
        importance_score: score,
        why_it_matters: pangu(String(parsed.why_it_matters || '').slice(0, 300)),
      },
    }
  } catch (err) {
    console.warn(
      `[LLM] processArticle fallback: using heuristic result after provider error: ${toErrText(err)}`
    )
    return { modelUsed: 'fallback', result: heuristicFallback(title, content, sourceCategory) }
  }
}

// ---- Batch processor ----

export interface ProcessOptions {
  /** Wall-clock deadline (Date.now() ms). Loop stops pulling chunks past this. */
  deadlineMs?: number
  /** Articles pulled per chunk inside the loop. Default 20. */
  chunkSize?: number
  /** Hard ceiling on total articles attempted this run. Default Infinity. */
  maxArticles?: number
}

/**
 * Drain the unprocessed-articles queue. With no options, behaves like a
 * one-shot batch (legacy). With `deadlineMs` / `maxArticles`, loops in
 * small chunks until the queue is empty, the deadline passes, or the cap
 * is hit — whichever comes first.
 *
 * Passing a plain number is the legacy signature: `processUnprocessedArticles(50)`
 * == `processUnprocessedArticles({ chunkSize: 50, maxArticles: 50 })`,
 * preserved so the Vercel cron HTTP route keeps working.
 */
export async function processUnprocessedArticles(
  options: ProcessOptions | number = {}
): Promise<{
  processed: number
  failed: number
}> {
  const opts: ProcessOptions = typeof options === 'number'
    ? { chunkSize: options, maxArticles: options }
    : options

  const deadlineMs = opts.deadlineMs ?? Number.POSITIVE_INFINITY
  const chunkSize = opts.chunkSize ?? 20
  const maxArticles = opts.maxArticles ?? Number.POSITIVE_INFINITY

  const supabase = createServiceClient()

  // Log job start — one row per run, not per chunk.
  const { data: job } = await supabase
    .from('job_runs')
    .insert({ job_type: 'process', status: 'running' })
    .select('id')
    .single()
  const jobId = job?.id

  let processed = 0
  let failed = 0

  // Main drain loop. Each iteration pulls one chunk and processes it.
  while (true) {
    if (Date.now() >= deadlineMs) {
      console.log(`[Processor] Deadline reached, stopping drain loop`)
      break
    }
    const attemptedSoFar = processed + failed
    if (attemptedSoFar >= maxArticles) break

    const remaining = maxArticles - attemptedSoFar
    const thisChunk = Math.min(chunkSize, remaining)

    const { data: articles, error } = await supabase
      .from('articles')
      .select('id, title, content, source_slug, process_attempts')
      .eq('is_processed', false)
      .is('skip_reason', null)
      .lt('process_attempts', 3)
      .order('published_at', { ascending: false })
      .limit(thisChunk)

    if (error) throw new Error(`Fetch error: ${error.message}`)
    if (!articles || articles.length === 0) {
      // Queue drained.
      break
    }

    console.log(`[Processor] Processing chunk of ${articles.length} articles (total so far: ${processed}/${attemptedSoFar})...`)

    for (const article of articles) {
      // Stop mid-chunk too if we crossed the deadline. The article we
      // skip stays unprocessed and the next run picks it up.
      if (Date.now() >= deadlineMs) {
        console.log(`[Processor] Deadline reached mid-chunk, stopping`)
        break
      }
      try {
        const src = SOURCE_CONFIGS.find(s => s.slug === article.source_slug)
        const sourceCategory = src?.category || 'media'
        const { result, modelUsed } = await processArticle(
          article.title,
          article.content || article.title,
          sourceCategory
        )

        const { error: insertError } = await supabase
          .from('processed_articles')
          .insert({
            article_id: article.id,
            summary_zh: result.summary_zh,
            category: result.category,
            tags: result.tags,
            importance_score: result.importance_score,
            why_it_matters: result.why_it_matters,
            model_used: modelUsed,
            is_fallback: modelUsed === 'fallback',
          })

        if (insertError) {
          // 23505 = a processed_articles row already exists for this article.
          // It was processed before; only articles.is_processed is out of sync.
          // Reconcile the flag and count it as processed — not a failure.
          if (isDuplicateKeyError(insertError)) {
            await supabase
              .from('articles')
              .update({ is_processed: true })
              .eq('id', article.id)
            processed++
            continue
          }
          console.error(`[Processor] Insert error for ${article.id}:`, insertError)
          failed++
          continue
        }

        await supabase
          .from('articles')
          .update({ is_processed: true })
          .eq('id', article.id)

        processed++
        await new Promise(r => setTimeout(r, 200))
      } catch (err) {
        console.error(`[Processor] Failed for article ${article.id}:`, err)
        const attempts = (article.process_attempts || 0) + 1
        const update: Record<string, unknown> = {
          process_attempts: attempts,
          last_error: String(err).slice(0, 500),
        }
        if (attempts >= 3) {
          update.skip_reason = `Failed after ${attempts} attempts: ${String(err).slice(0, 200)}`
        }
        await supabase.from('articles').update(update).eq('id', article.id)
        failed++
      }
    }
  }

  console.log(`[Processor] Done: ${processed} processed, ${failed} failed`)

  // Log job finish
  if (jobId) {
    await supabase.from('job_runs').update({
      status: failed > 0 && processed === 0 ? 'failed' : 'success',
      finished_at: new Date().toISOString(),
      success_count: processed,
      fail_count: failed,
    }).eq('id', jobId)
  }

  return { processed, failed }
}

// ---- Fallback reprocessor ----

export async function reprocessFallbackArticles(batchSize = 10): Promise<{
  reprocessed: number
  failed: number
}> {
  const supabase = createServiceClient()

  // Find fallback processed_articles that haven't exceeded retry limit
  const { data: fallbacks, error } = await supabase
    .from('processed_articles')
    .select('id, article_id, reprocess_attempts')
    .eq('is_fallback', true)
    .lt('reprocess_attempts', 3)
    .order('processed_at', { ascending: false })
    .limit(batchSize)

  if (error) throw new Error(`Fallback fetch error: ${error.message}`)
  if (!fallbacks || fallbacks.length === 0) return { reprocessed: 0, failed: 0 }

  console.log(`[Reprocess] Found ${fallbacks.length} fallback articles to retry`)

  let reprocessed = 0
  let failed = 0
  // Transient, self-healing retries (usually LLM quota exhaustion). Tracked
  // for visibility but deliberately NOT counted as failures so they never
  // alarm the workflow — they succeed on a later run once quota resets.
  let pending = 0

  for (const fb of fallbacks) {
    try {
      // Get original article data
      const { data: article } = await supabase
        .from('articles')
        .select('title, content, source_slug')
        .eq('id', fb.article_id)
        .single()

      if (!article) {
        // Source article was deleted — retire the orphan row. Housekeeping,
        // not a failure.
        await supabase.from('processed_articles')
          .update({ reprocess_attempts: 3 })
          .eq('id', fb.id)
        continue
      }

      const src = SOURCE_CONFIGS.find(s => s.slug === article.source_slug)
      const sourceCategory = src?.category || 'media'

      const { result, modelUsed } = await processArticle(
        article.title,
        article.content || article.title,
        sourceCategory
      )

      if (modelUsed === 'fallback') {
        // Still no real result (usually LLM quota exhaustion). Record the
        // attempt for backoff, but treat it as a pending retry — not a
        // failure — so a quota-only run does not alarm the workflow.
        await supabase.from('processed_articles')
          .update({ reprocess_attempts: fb.reprocess_attempts + 1 })
          .eq('id', fb.id)
        pending++
        continue
      }

      // Success — update with real LLM results
      await supabase.from('processed_articles')
        .update({
          summary_zh: result.summary_zh,
          category: result.category,
          tags: result.tags,
          importance_score: result.importance_score,
          why_it_matters: result.why_it_matters,
          model_used: modelUsed,
          is_fallback: false,
          processed_at: new Date().toISOString(),
        })
        .eq('id', fb.id)

      reprocessed++
      await new Promise(r => setTimeout(r, 200))
    } catch (err) {
      console.error(`[Reprocess] Failed for ${fb.id}:`, err)
      await supabase.from('processed_articles')
        .update({ reprocess_attempts: fb.reprocess_attempts + 1 })
        .eq('id', fb.id)
      failed++
    }
  }

  console.log(
    `[Reprocess] Done: ${reprocessed} reprocessed, ${pending} pending (retry later), ${failed} failed`
  )
  return { reprocessed, failed }
}
