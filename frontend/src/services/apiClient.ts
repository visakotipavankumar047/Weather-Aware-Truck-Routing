// Dev: talk to Django directly (CORS is configured for http://localhost:5173).
// Prod: relative /api behind the same domain. Override with VITE_API_BASE_URL.
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : '/api')

export class ApiError extends Error {
  status: number
  fields: Record<string, string>
  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
  /** Retrying is only offered for transient failures. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

function parseError(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (typeof obj.detail === 'string') return new ApiError(obj.detail, status)
    const fields: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      fields[k] = Array.isArray(v) ? String(v[0]) : String(v)
    }
    const msg = Object.entries(fields)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join(' · ')
    if (msg) return new ApiError(msg, status, fields)
  }
  return new ApiError(`Request failed (HTTP ${status}).`, status)
}

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export async function api<T>(
  path: string,
  { method = 'GET', body, timeoutMs = 20000, signal }: Options = {},
): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) throw parseError(res.status, data)
    return data as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (timedOut) throw new ApiError('The request timed out. Please try again.', 0)
    if (signal?.aborted) throw e
    throw new ApiError('Cannot reach the backend. Check that the API is running.', 0)
  } finally {
    clearTimeout(timer)
  }
}
