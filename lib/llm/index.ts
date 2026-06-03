import Anthropic from '@anthropic-ai/sdk'

import { createServiceClient } from '../supabase'
import {
  getDynamicChain,
  markModelFailure,
  markModelSuccess,
} from './discovery'

export type LLMProvider = 'anthropic' | 'openai-compatible'
export type LLMTask = 'article' | 'digest'

interface GenerateParams {
  task: LLMTask
  prompt: string
  maxTokens: number
}

interface GenerateResult {
  text: string
  modelUsed: string
  provider: LLMProvider
}

interface ResolvedConfig {
  provider: LLMProvider
  apiKey: string
  baseURL: string
  model: string
}

function trimOrEmpty(value: string | undefined): string {
  return value?.trim() || ''
}

function normalizeAnthropicBaseURL(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.hostname === 'right.codes') u.hostname = 'www.right.codes'
    return u.toString().replace(/\/+$/, '')
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

function normalizeBaseURL(raw: string, provider: LLMProvider): string {
  const fallback = provider === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1'

  const value = trimOrEmpty(raw) || fallback
  return provider === 'anthropic'
    ? normalizeAnthropicBaseURL(value)
    : value.replace(/\/+$/, '')
}

function inferProvider(baseURL: string): LLMProvider {
  const normalized = trimOrEmpty(baseURL).toLowerCase()
  if (!normalized) return 'anthropic'
  if (
    normalized.includes('anthropic.com') ||
    normalized.includes('right.codes') ||
    normalized.includes('/claude')
  ) {
    return 'anthropic'
  }
  return 'openai-compatible'
}

function defaultModelFor(task: LLMTask, provider: LLMProvider, baseURL: string): string {
  const normalized = baseURL.toLowerCase()

  if (provider === 'anthropic') {
    return task === 'article'
      ? 'claude-3-5-haiku-20241022'
      : 'claude-sonnet-4-5-20250929'
  }

  if (normalized.includes('dashscope.aliyuncs.com')) {
    return task === 'article' ? 'qwen-plus' : 'qwen-max'
  }

  if (normalized.includes('api.openai.com')) {
    return task === 'article' ? 'gpt-4.1-mini' : 'gpt-4.1'
  }

  const explicitModel =
    trimOrEmpty(process.env.LLM_MODEL) ||
    trimOrEmpty(process.env.CLAUDE_SMALL_MODEL) ||
    trimOrEmpty(process.env.CLAUDE_LARGE_MODEL)

  if (explicitModel) return explicitModel

  throw new Error(
    `No default model is defined for ${baseURL}. Set LLM_MODEL to use this OpenAI-compatible endpoint.`
  )
}

function resolveConfig(task: LLMTask): ResolvedConfig {
  const apiKey =
    trimOrEmpty(process.env.LLM_API_KEY)

  if (!apiKey) {
    throw new Error('Missing LLM_API_KEY')
  }

  const rawBaseURL =
    trimOrEmpty(process.env.LLM_BASE_URL)

  const provider = inferProvider(rawBaseURL)
  const baseURL = normalizeBaseURL(rawBaseURL, provider)
  const model =
    trimOrEmpty(process.env.LLM_MODEL) ||
    (
      task === 'article'
        ? trimOrEmpty(process.env.CLAUDE_SMALL_MODEL)
        : trimOrEmpty(process.env.CLAUDE_LARGE_MODEL)
    ) ||
    defaultModelFor(task, provider, baseURL)

  return { provider, apiKey, baseURL, model }
}

// Resolve the env-baked fallback chain. Used directly when DB lookup
// fails and as the seed for getDynamicChain folding.
function resolveStaticChain(task: LLMTask): string[] {
  const raw = trimOrEmpty(process.env.LLM_MODEL_CHAIN)
  const primary = resolveConfig(task).model
  if (!raw) return [primary]
  const chain = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  // Ensure primary is first; dedupe while preserving order.
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const m of [primary, ...chain]) {
    if (seen.has(m)) continue
    seen.add(m)
    ordered.push(m)
  }
  return ordered
}

// Try to build a healthy chain from llm_model_health (per-model status).
// Any DB error path falls back to the env-baked chain silently so the
// LLM call layer never goes dark.
async function resolveDynamicChain(task: LLMTask, provider: LLMProvider): Promise<string[]> {
  const staticChain = resolveStaticChain(task)
  // We only track openai-compatible providers for now — Anthropic is
  // single-model and not part of the rotation.
  if (provider !== 'openai-compatible') return staticChain
  if (process.env.LLM_DYNAMIC_CHAIN === 'off') return staticChain
  try {
    const client = createServiceClient()
    return await getDynamicChain(client, providerKey(), staticChain)
  } catch {
    return staticChain
  }
}

// Single-provider mode for now: 'dashscope' covers DashScope-compatible
// endpoints; everything else still uses the env chain only.
function providerKey(): string {
  const base = (process.env.LLM_BASE_URL || '').toLowerCase()
  if (base.includes('dashscope.aliyuncs.com')) return 'dashscope'
  return 'openai-compatible'
}

// Errors worth swapping models for: free-tier exhaustion, quota,
// rate limit. We do NOT swap on network or 5xx errors — those are
// transient and callWithRetry handles them.
function isQuotaExhaustionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: number; message?: string }
  if (e.status === 429) return true
  if (e.status !== 403) return false
  const msg = (e.message || '').toLowerCase()
  return (
    msg.includes('freetieronly') ||
    msg.includes('free tier') ||
    msg.includes('allocationquota') ||
    msg.includes('exhausted') ||
    msg.includes('insufficient') ||
    msg.includes('quota')
  )
}

const toErrText = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>
    const message = anyErr.message
    if (typeof message === 'string') return message
  }
  return String(err)
}

const shouldRetry = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return true
  const status = (err as { status?: number }).status
  if (typeof status !== 'number') return true
  return status === 429 || status >= 500
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries - 1 || !shouldRetry(err)) throw err
      const delay = Math.pow(2, i) * 1000
      console.warn(`[LLM] Retry ${i + 1}/${retries} after ${delay}ms: ${toErrText(err)}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Unreachable')
}

// Hard ceiling on a single LLM call. Picked to be much larger than the
// observed ~32s/article so legitimate slow calls survive, while a
// half-open TCP connection or a hung upstream can no longer hold the
// process hostage for hours. The outer GH job timeout (180min) then
// becomes a real last-resort backstop instead of the only one.
const LLM_CALL_TIMEOUT_MS = 60_000

async function generateWithAnthropic(config: ResolvedConfig, prompt: string, maxTokens: number): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: LLM_CALL_TIMEOUT_MS,
  })

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  })

  const block = response.content[0]
  return block?.type === 'text' ? block.text.trim() : ''
}

async function generateWithOpenAICompatible(config: ResolvedConfig, prompt: string, maxTokens: number): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LLM_CALL_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      const err = new Error(`OpenAI-compatible request failed (${response.status}): ${body.slice(0, 300)}`) as Error & { status?: number }
      err.status = response.status
      throw err
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
    }

    const content = payload.choices?.[0]?.message?.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map(part => typeof part?.text === 'string' ? part.text : '')
        .join('')
        .trim()
    }
    return ''
  } catch (err) {
    // Surface AbortError as a clear timeout message so the caller can
    // treat it like any other transient upstream failure (and the model
    // chain falls through to the next candidate).
    if (err instanceof Error && err.name === 'AbortError') {
      const e = new Error(`OpenAI-compatible request timed out after ${LLM_CALL_TIMEOUT_MS}ms`) as Error & { status?: number }
      e.status = 408
      throw e
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// Best-effort telemetry: if Supabase is unreachable, swallow — the LLM
// call itself must not fail because of a health-table glitch.
async function recordTelemetry(
  provider: LLMProvider,
  modelId: string,
  outcome: { ok: true; latencyMs: number } | { ok: false; err: { status?: number; message?: string } }
): Promise<void> {
  if (provider !== 'openai-compatible') return
  if (process.env.LLM_DYNAMIC_CHAIN === 'off') return
  try {
    const client = createServiceClient()
    if (outcome.ok) {
      await markModelSuccess(client, providerKey(), modelId, outcome.latencyMs)
    } else {
      await markModelFailure(client, providerKey(), modelId, outcome.err)
    }
  } catch {
    /* telemetry must never break the request path */
  }
}

async function generate(params: GenerateParams): Promise<GenerateResult> {
  const baseConfig = resolveConfig(params.task)
  const chain = await resolveDynamicChain(params.task, baseConfig.provider)
  const errors: string[] = []

  for (let i = 0; i < chain.length; i++) {
    const config: ResolvedConfig = { ...baseConfig, model: chain[i] }
    const start = Date.now()
    try {
      const text = await callWithRetry(async () => {
        if (config.provider === 'anthropic') {
          return generateWithAnthropic(config, params.prompt, params.maxTokens)
        }
        return generateWithOpenAICompatible(config, params.prompt, params.maxTokens)
      })
      if (!text) throw new Error('LLM returned empty content')
      if (i > 0) {
        console.warn(
          `[LLM] Falling back to model ${config.model} after ${i} exhausted upstream(s)`
        )
      }
      await recordTelemetry(config.provider, chain[i], { ok: true, latencyMs: Date.now() - start })
      return {
        text,
        modelUsed: `${config.provider}:${config.model}`,
        provider: config.provider,
      }
    } catch (err) {
      errors.push(`${chain[i]}: ${toErrText(err)}`)
      const errLike = {
        status: (err as { status?: number }).status,
        message: toErrText(err),
      }
      await recordTelemetry(config.provider, chain[i], { ok: false, err: errLike })
      // Only try next model on quota / free-tier exhaustion. Other errors
      // (transient, programming, prompt) bubble up immediately.
      if (!isQuotaExhaustionError(err) || i === chain.length - 1) throw err
      console.warn(
        `[LLM] Model ${chain[i]} exhausted (${(err as { status?: number }).status}), trying ${chain[i + 1]}`
      )
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error(`All LLM models exhausted: ${errors.join(' | ')}`)
}

export async function generateJson(params: GenerateParams): Promise<GenerateResult> {
  return generate(params)
}

export async function generateText(params: GenerateParams): Promise<GenerateResult> {
  return generate(params)
}

export function getResolvedLLMConfig(task: LLMTask) {
  return resolveConfig(task)
}
