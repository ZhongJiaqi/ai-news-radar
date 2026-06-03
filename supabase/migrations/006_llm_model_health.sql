-- ======================================================
-- AI Radar - LLM Model Health Self-Healing
-- Tracks per-model availability for dynamic chain routing.
-- ======================================================

-- 1. llm_model_health table
CREATE TABLE IF NOT EXISTS llm_model_health (
  provider          TEXT        NOT NULL,
  model_id          TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'unknown'
                                CHECK (status IN ('available', 'exhausted', 'broken', 'unknown')),
  exhausted_until   TIMESTAMPTZ,
  last_success_at   TIMESTAMPTZ,
  last_error_at     TIMESTAMPTZ,
  last_error_status INTEGER,
  last_error_message TEXT,
  avg_latency_ms    INTEGER,
  success_count     INTEGER     NOT NULL DEFAULT 0,
  failure_count     INTEGER     NOT NULL DEFAULT 0,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, model_id)
);

-- 2. Index for priority chain query (available models, freshest success first)
CREATE INDEX IF NOT EXISTS llm_model_health_priority_idx
  ON llm_model_health (provider, status, last_success_at DESC NULLS LAST);

-- 3. Index for revive sweep (find exhausted models whose window has passed)
CREATE INDEX IF NOT EXISTS llm_model_health_exhausted_until_idx
  ON llm_model_health (exhausted_until)
  WHERE status = 'exhausted';

-- 4. RLS: only service role can touch this table
ALTER TABLE llm_model_health ENABLE ROW LEVEL SECURITY;
-- No policies defined → anon/authenticated get zero access.
-- Service role bypasses RLS automatically.
