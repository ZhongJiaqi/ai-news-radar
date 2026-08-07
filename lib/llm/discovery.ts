// ======================================================
// AI Radar - LLM Model Health Self-Healing
//
// Single-provider auto-healing:
//   - discoverModels(): pulls live model list from provider's /v1/models
//     and UPSERTs into llm_model_health so newly-released models surface
//     automatically.
//   - reviveExhaustedModels(): flips status='exhausted' rows whose
//     exhausted_until has passed back to 'available'.
//   - markModelSuccess() / markModelFailure(): runtime telemetry that
//     drives the routing priority.
//   - getDynamicChain(): the authoritative chain at call-time, sorted by
//     freshness of last success then latency.
//   - probeModel(): 1-token minimal call used by sweep when chain is
//     empty (last-resort discovery).
//
// Side-effects use the supabase-js service client (RLS-bypassing). The
// table only has private access by design — anon clients cannot read.
// ======================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isConfirmedFreeModel } from './free-models'

export type ModelStatus = 'available' | 'exhausted' | 'broken' | 'unknown'

// Task-fit filter. Non-chat SKUs (OCR / vision / audio / media / domain
// specialists) answer a 1-token probe with 200 OK yet cannot score or
// summarize articles — qwen3.5-ocr hijacked the chain for 6 days
// (2026-07-16..22) exactly this way.
const NON_CHAT_ID_PATTERN = new RegExp(
  [
    'ocr', 'omni', 'audio', 'asr', 'tts', 'speech', 'voice',
    'paraformer', 'sambert', 'cosyvoice', 'embedding', 'rerank',
    'wanx', 'wan2', 't2v', 'i2v', 't2i', 'image', 'video', 'captioner',
    'qvq', '-vl', 'vl-', 'flux', 'stable-diffusion', '(^|-)mt-',
    'doc-turbo', 'doc-mind', 'farui', 'character', 'realtime',
    'avatar', 'animate',
  ].join('|')
)

export function isChatCapableModelId(modelId: string): boolean {
  return !NON_CHAT_ID_PATTERN.test(modelId.toLowerCase())
}

// The only gate through which a model may enter the calling chain:
// task-fit AND officially confirmed free. Applies to DB rows and the env
// fallback chain alike — a stale env entry must not bypass the guard.
export function isChainEligibleModel(modelId: string): boolean {
  return isChatCapableModelId(modelId) && isConfirmedFreeModel(modelId)
}

export interface ModelHealthRow {
  provider: string
  model_id: string
  status: ModelStatus
  exhausted_until: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_status: number | null
  last_error_message: string | null
  avg_latency_ms: number | null
  success_count: number
  failure_count: number
  discovered_at: string
  updated_at: string
}

const TABLE = 'llm_model_health'

// Used for transient throttling (429): retry from the next UTC midnight.
function nextResetISO(now: Date = new Date()): string {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ))
  return next.toISOString()
}

// DashScope free quotas are ONE-TIME grants, not daily resets: models that
// 403'd on 2026-06-04 kept failing forever (6600+ failures each). Bench a
// quota-dead model long enough that daily revive can't zombie it back —
// zombies inflate the available count and block the probe-sweep trigger.
const QUOTA_EXHAUSTED_COOLDOWN_MS = 90 * 86400_000

// Account arrearage blocks ALL models but clears the moment the bill is
// paid — bench briefly so the chain falls through without poisoning the
// pool for a whole day.
const ARREARAGE_COOLDOWN_MS = 3600_000

function isArrearageError(err: { status?: number; message?: string }): boolean {
  const msg = (err.message || '').toLowerCase()
  return msg.includes('arrearage') || msg.includes('overdue')
}

function isEmptyContentError(err: { message?: string }): boolean {
  return (err.message || '').toLowerCase().includes('returned empty content')
}

export function isQuotaExhaustionError(err: { status?: number; message?: string }): boolean {
  if (err.status === 429) return true
  // Account-level blockade arrives as 400 "Access denied ... Arrearage /
  // overdue-payment" — treat as exhaustion so the chain falls through and
  // digest-level alerts fire instead of silently retrying.
  if (isArrearageError(err)) return true
  if (err.status !== 403) return false
  const msg = (err.message || '').toLowerCase()
  return (
    msg.includes('freetieronly') ||
    msg.includes('free tier') ||
    msg.includes('allocationquota') ||
    msg.includes('exhausted') ||
    msg.includes('insufficient') ||
    msg.includes('quota')
  )
}

function exhaustionUntilISO(err: { status?: number; message?: string }): string {
  if (isArrearageError(err)) {
    return new Date(Date.now() + ARREARAGE_COOLDOWN_MS).toISOString()
  }
  if (err.status === 403) {
    return new Date(Date.now() + QUOTA_EXHAUSTED_COOLDOWN_MS).toISOString()
  }
  // A 200 response with no usable content is often model-specific. Bench it
  // until the next UTC day so another model can take over, then allow the
  // normal revival/probe loop to reassess it.
  if (isEmptyContentError(err)) return nextResetISO()
  return nextResetISO()
}

function ema(prev: number | null, sample: number, alpha = 0.3): number {
  if (prev == null || prev <= 0) return Math.round(sample)
  return Math.round(prev * (1 - alpha) + sample * alpha)
}

// ----------------------- Public API -----------------------

export async function markModelSuccess(
  client: SupabaseClient,
  provider: string,
  modelId: string,
  latencyMs: number
): Promise<void> {
  const { data: row } = await client
    .from(TABLE)
    .select('avg_latency_ms, success_count')
    .eq('provider', provider)
    .eq('model_id', modelId)
    .maybeSingle()

  const nextAvg = ema(row?.avg_latency_ms ?? null, latencyMs)
  const nextCount = (row?.success_count ?? 0) + 1

  await client.from(TABLE).upsert({
    provider,
    model_id: modelId,
    status: 'available',
    exhausted_until: null,
    last_success_at: new Date().toISOString(),
    avg_latency_ms: nextAvg,
    success_count: nextCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,model_id' })
}

export async function markModelFailure(
  client: SupabaseClient,
  provider: string,
  modelId: string,
  err: { status?: number; message?: string }
): Promise<void> {
  const { data: row } = await client
    .from(TABLE)
    .select('failure_count')
    .eq('provider', provider)
    .eq('model_id', modelId)
    .maybeSingle()

  const quotaIssue = isQuotaExhaustionError(err)
  const unusableOutput = isEmptyContentError(err)
  // 401/403 without quota signal = key/model truly broken (not a quota issue).
  // 4xx that isn't 403/429 = caller-side prompt problem, do not poison the
  // model's health.
  const status: ModelStatus | undefined = quotaIssue || unusableOutput
    ? 'exhausted'
    : err.status === 401 || err.status === 404
      ? 'broken'
      : undefined

  const update: Record<string, unknown> = {
    provider,
    model_id: modelId,
    last_error_at: new Date().toISOString(),
    last_error_status: err.status ?? null,
    last_error_message: (err.message || '').slice(0, 200),
    failure_count: (row?.failure_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }

  if (status === 'exhausted') {
    update.status = 'exhausted'
    update.exhausted_until = exhaustionUntilISO(err)
  } else if (status === 'broken') {
    update.status = 'broken'
    update.exhausted_until = null
  }

  await client.from(TABLE).upsert(update, { onConflict: 'provider,model_id' })
}

export async function reviveExhaustedModels(
  client: SupabaseClient,
  provider: string
): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data } = await client
    .from(TABLE)
    .update({
      status: 'available',
      exhausted_until: null,
      updated_at: nowIso,
    })
    .eq('provider', provider)
    .eq('status', 'exhausted')
    .lt('exhausted_until', nowIso)
    .select('model_id')

  return data?.length ?? 0
}

export async function getDynamicChain(
  client: SupabaseClient,
  provider: string,
  fallbackChain: string[]
): Promise<string[]> {
  const { data, error } = await client
    .from(TABLE)
    .select('model_id, last_success_at, avg_latency_ms')
    .eq('provider', provider)
    .eq('status', 'available')
    .order('last_success_at', { ascending: false, nullsFirst: false })
    .order('avg_latency_ms', { ascending: true, nullsFirst: false })

  if (error || !data || data.length === 0) {
    return fallbackChain.filter(isChainEligibleModel)
  }

  const dbChain = data
    .map(r => r.model_id as string)
    .filter(isChainEligibleModel)
  // Fold in any env-fallback model not yet known to the table so first
  // boot still works before any telemetry exists.
  const seen = new Set(dbChain)
  for (const m of fallbackChain) {
    if (!seen.has(m) && isChainEligibleModel(m)) {
      dbChain.push(m)
      seen.add(m)
    }
  }
  return dbChain
}

// ----- Discovery (cold-start + new model auto-registration) -----

interface ProviderModelsResponse {
  data?: Array<{ id?: string }>
}

export async function discoverModels(
  client: SupabaseClient,
  provider: string,
  baseURL: string,
  apiKey: string
): Promise<string[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`
  let modelIds: string[] = []

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return []
    const payload = (await res.json()) as ProviderModelsResponse
    modelIds = (payload.data || [])
      .map(m => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }

  if (modelIds.length === 0) return []

  // INSERT-only on conflict: do not overwrite existing health telemetry.
  // We just want new IDs to appear with status='unknown' for the sweep
  // path to test them later.
  const nowIso = new Date().toISOString()
  await client.from(TABLE).upsert(
    modelIds.map(id => ({
      provider,
      model_id: id,
      status: 'unknown',
      discovered_at: nowIso,
      updated_at: nowIso,
    })),
    { onConflict: 'provider,model_id', ignoreDuplicates: true }
  )

  return modelIds
}

// Per-probe wall-clock cap. Sweep is sequential, so a hanging unknown
// model would block the entire warm-up — bound it to 10s.
const PROBE_TIMEOUT_MS = 10_000

// 1-token minimal probe; updates row to available/exhausted/broken based
// on outcome. Used by sweep when no available model exists.
export async function probeModel(
  client: SupabaseClient,
  provider: string,
  baseURL: string,
  apiKey: string,
  modelId: string
): Promise<ModelStatus> {
  const start = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: ctl.signal,
    })
    if (res.ok) {
      await markModelSuccess(client, provider, modelId, Date.now() - start)
      return 'available'
    }
    const text = await res.text()
    const err = { status: res.status, message: text.slice(0, 200) }
    await markModelFailure(client, provider, modelId, err)
    return isQuotaExhaustionError(err) ? 'exhausted' : 'broken'
  } catch (e) {
    await markModelFailure(client, provider, modelId, {
      message: e instanceof Error ? e.message : String(e),
    })
    return 'broken'
  } finally {
    clearTimeout(timer)
  }
}

// Sweep unknown rows for a provider. Returns IDs that turned available.
// Sequential to keep per-provider rate-limit pressure bounded; 10s timeout
// per probe via probeModel.
export async function probeSweep(
  client: SupabaseClient,
  provider: string,
  baseURL: string,
  apiKey: string,
  limit = 5
): Promise<string[]> {
  const { data } = await client
    .from(TABLE)
    .select('model_id')
    .eq('provider', provider)
    .eq('status', 'unknown')
    .limit(1000)

  if (!data || data.length === 0) return []

  const ids = data.map(r => r.model_id as string)

  // Retire non-chat SKUs permanently so they never clog the unknown pool
  // or get probed into the chain again.
  const nonChat = ids.filter(id => !isChatCapableModelId(id))
  if (nonChat.length > 0) {
    const nowIso = new Date().toISOString()
    await client.from(TABLE).upsert(
      nonChat.map(id => ({
        provider,
        model_id: id,
        status: 'broken',
        last_error_message: 'non-chat model (task-fit filter)',
        updated_at: nowIso,
      })),
      { onConflict: 'provider,model_id' }
    )
  }

  // Probing a paid model "succeeds" and pulls it into the chain where it
  // burns money (2026-06-16 omni-plus incident). Only officially confirmed
  // free models may be probed; the rest stay 'unknown' until the whitelist
  // is refreshed from console data.
  const candidates = ids.filter(isChainEligibleModel).slice(0, limit)

  const newlyAvailable: string[] = []
  for (const modelId of candidates) {
    const status = await probeModel(client, provider, baseURL, apiKey, modelId)
    if (status === 'available') newlyAvailable.push(modelId)
  }
  return newlyAvailable
}

// Count chain-eligible available models for a provider. Lets warm-up decide
// whether the known chain is healthy or it needs to sweep the unknown pool.
// Must apply the same eligibility gate as getDynamicChain — an available
// row the chain can't use (non-chat / unverified) would otherwise suppress
// the sweep trigger forever.
export async function countAvailableModels(
  client: SupabaseClient,
  provider: string
): Promise<number> {
  const { data } = await client
    .from(TABLE)
    .select('model_id')
    .eq('provider', provider)
    .eq('status', 'available')
  return (data ?? []).filter(r => isChainEligibleModel(r.model_id as string)).length
}
