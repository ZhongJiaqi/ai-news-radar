// ======================================================
// AI Radar - "model pool empty" alert throttle
//
// When every free model's quota is gone (available=0 AND probe sweep
// promoted nothing), the user wants a proactive Lark ping — but process
// runs 8+ times/day, so the notification must be throttled to at most
// one per day.
//
// The throttle state lives as a sentinel row in llm_model_health under
// provider='_meta' (PK provider,model_id). Every business query filters
// on a real provider ('dashscope'), so the sentinel is invisible to the
// chain / sweep / revive paths. last_error_at holds the last-notified
// timestamp — no migration needed.
// ======================================================

import type { SupabaseClient } from '@supabase/supabase-js'

const TABLE = 'llm_model_health'
const SENTINEL_PROVIDER = '_meta'
const SENTINEL_MODEL_ID = 'pool-empty-alert'

// 20h instead of 24h: GH cron drifts up to a couple of hours, and a
// strict 24h window would slowly push the daily alert later every day
// until one day gets skipped entirely.
const THROTTLE_MS = 20 * 3600_000

export async function shouldNotifyPoolEmpty(
  client: SupabaseClient,
  now: Date = new Date()
): Promise<boolean> {
  const { data } = await client
    .from(TABLE)
    .select('last_error_at')
    .eq('provider', SENTINEL_PROVIDER)
    .eq('model_id', SENTINEL_MODEL_ID)
    .maybeSingle()

  if (!data?.last_error_at) return true
  return now.getTime() - new Date(data.last_error_at).getTime() > THROTTLE_MS
}

export async function markPoolEmptyNotified(
  client: SupabaseClient,
  now: Date = new Date()
): Promise<void> {
  await client.from(TABLE).upsert(
    {
      provider: SENTINEL_PROVIDER,
      model_id: SENTINEL_MODEL_ID,
      status: 'broken',
      last_error_at: now.toISOString(),
      last_error_message: 'sentinel row: last pool-empty Lark notification timestamp',
      updated_at: now.toISOString(),
    },
    { onConflict: 'provider,model_id' }
  )
}
