import type { EventDetail, EventsPage, Filters } from './types'

export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type ErrorKind = 'http' | 'network' | 'timeout' | 'not-found'

export class ApiError extends Error {
  readonly kind: ErrorKind
  readonly status?: number
  constructor(kind: ErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
  /** Worth offering "Try again" for; a 404 or 400 will not get better. */
  get retryable() {
    return this.kind !== 'not-found' && !(this.status && this.status >= 400 && this.status < 500 && this.status !== 429)
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  /** Automatic retries for transient failures (network, 5xx, 429). GET is idempotent so this is safe. */
  retries?: number
  timeoutMs?: number
  /** Called before each automatic retry so the UI can say so. */
  onRetry?: (attempt: number) => void
}

const RETRY_DELAYS = [350, 1000, 2200]

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

async function attempt<T>(url: string, { signal, timeoutMs = 20_000 }: RequestOptions): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
  try {
    const res = await fetch(url, { signal: combined, headers: { Accept: 'application/json' } })
    if (res.status === 404) throw new ApiError('not-found', 'Not found', 404)
    if (!res.ok) {
      let detail = ''
      try {
        detail = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        /* body wasn't JSON */
      }
      throw new ApiError('http', detail || `Server responded ${res.status}`, res.status)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (signal?.aborted) throw signal.reason ?? err // caller cancelled: not an error to show
    if (timeout.signal.aborted) throw new ApiError('timeout', 'The server took too long to respond')
    throw new ApiError('network', 'Could not reach the server')
  } finally {
    clearTimeout(timer)
  }
}

export async function request<T>(path: string, params: URLSearchParams | undefined, opts: RequestOptions = {}): Promise<T> {
  const qs = params?.toString()
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`
  const retries = opts.retries ?? 2
  for (let n = 0; ; n++) {
    try {
      return await attempt<T>(url, opts)
    } catch (err) {
      const canRetry = err instanceof ApiError && err.retryable && n < retries
      if (!canRetry) throw err
      opts.onRetry?.(n + 1)
      await sleep(RETRY_DELAYS[Math.min(n, RETRY_DELAYS.length - 1)], opts.signal)
    }
  }
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  for (const a of f.agents) p.append('agent', a)
  if (f.status) p.set('status', f.status)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p
}

export const PAGE_SIZE = 100

export function fetchEvents(filters: Filters, cursor: string | null, opts: RequestOptions) {
  const p = filtersToParams(filters)
  p.set('limit', String(PAGE_SIZE))
  if (cursor) p.set('cursor', cursor)
  return request<EventsPage>('/events', p, opts)
}

export function fetchEvent(id: string, opts: RequestOptions) {
  return request<EventDetail>(`/events/${encodeURIComponent(id)}`, undefined, opts)
}

export function fetchAgents(opts: RequestOptions) {
  return request<string[]>('/agents', undefined, opts)
}
