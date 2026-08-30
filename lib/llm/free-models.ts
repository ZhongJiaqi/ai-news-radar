// ======================================================
// AI Radar - Confirmed free-tier chat model whitelist
//
// Source of truth: aliyun Bailian console internal API
// `freeTierQuotaAsyn` (freeTierOnly=true entries), pulled manually on
// 2026-06-20 via browser DevTools, plus the legacy env-chain models that
// ran free for months. There is NO public API for this data — refreshing
// the list requires re-pulling it from the console (cookie-authed).
//
// Why a hard whitelist: probing only checks "does a 1-token call return
// 200", which is also true for PAID models — that is how qwen3.5-omni-plus
// burned money on 2026-06-16..20. Models not on this list must never be
// probed or enter the chain, no matter what the health table says.
// ======================================================

export const CONFIRMED_FREE_CHAT_MODELS: readonly string[] = [
  // user-confirmed free with full remaining quota per console, 2026-08-30
  'qwen3.8-flash',
  'qwen3.8-27b',
  'kimi-k3',
  'deepseek-v4-pro-0813',
  // qwen3.8-2.4t-a95b is also free, but requires enable_thinking=true;
  // incompatible with this pipeline's bounded visible-output contract.
  // user-confirmed free with remaining quota per aliyun console, 2026-08-07
  'deepseek-v4-flash-0731',
  'qwen3.8-max',
  // user-confirmed free with remaining quota per aliyun console, 2026-07-31
  'qwen3.7-flash-2026-07-15',
  // freeTierOnly=true per aliyun data 2026-06-20
  'qwen3.7-plus',
  'qwen3.7-plus-2026-05-26',
  'qwen3.7-max',
  'qwen3.7-max-preview',
  'qwen3.7-max-2026-05-17',
  'qwen3.7-max-2026-05-20',
  'qwen3.7-max-2026-06-08',
  'qwen3.6-plus',
  'qwen3.6-plus-2026-04-02',
  'qwen3.6-max-preview',
  'qwen3.6-35b-a3b',
  'qwen3.6-27b',
  'qwen3.5-plus-2026-04-20',
  // NOTE: qwen3.5-ocr is also freeTierOnly=true per the same data, but it
  // is NOT a chat model — deliberately left off this list (it hijacked the
  // chain 2026-07-16..22 producing garbage scores and template echoes).
  'deepseek-v4-pro',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'glm-5.2',
  // legacy env-chain models (ran on free tier 2026-04..06, quotas long gone
  // but harmless to keep listed)
  'qwen-turbo',
  'deepseek-v4-flash',
  'qwen3.6-flash',
]

const FREE_SET = new Set(CONFIRMED_FREE_CHAT_MODELS)

export function isConfirmedFreeModel(modelId: string): boolean {
  return FREE_SET.has(modelId)
}
