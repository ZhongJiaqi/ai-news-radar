// ======================================================
// AI Radar - DB query resilience
// Wraps a Supabase query thunk with a per-attempt timeout
// and bounded retries, to ride out intermittent
// "fetch failed" hiccups talking to Supabase.
// ======================================================

export interface QueryResult<T> {
  data: T | null
  error: unknown
}

interface RetryOptions {
  retries?: number
  timeoutMs?: number
  delayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('query timeout')), ms)
    Promise.resolve(p).then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}

/**
 * Run a Supabase query thunk with a per-attempt timeout and retries.
 * Retries when the attempt returns an `error` or throws. Returns the
 * last result (success as soon as one attempt has no error).
 */
export async function queryWithRetry<T>(
  run: () => PromiseLike<QueryResult<T>>,
  opts: RetryOptions = {}
): Promise<QueryResult<T>> {
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 6000
  const delayMs = opts.delayMs ?? 300

  let last: QueryResult<T> = { data: null, error: new Error('query not attempted') }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      last = await withTimeout(run(), timeoutMs)
      if (!last.error) return last
    } catch (err) {
      last = { data: null, error: err }
    }
    if (attempt < retries) await sleep(delayMs)
  }

  return last
}

/** Supabase `.single()` returns this code when zero rows match — a genuine
 * "not found", distinct from a transient fetch/connection failure. */
export function isNoRowsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'PGRST116'
}
