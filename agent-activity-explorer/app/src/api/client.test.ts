import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, filtersToParams, request } from './client'
import { EMPTY_FILTERS } from './types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.restoreAllMocks())

describe('request', () => {
  it('retries 5xx and then succeeds', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'internal server error' }, 500)).mockResolvedValueOnce(json({ ok: 1 }))
    const onRetry = vi.fn()
    await expect(request('/x', undefined, { onRetry })).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(1)
  })
  it('gives up after the retry budget and surfaces the status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ error: 'boom' }, 500))
    await expect(request('/x', undefined, { retries: 1 })).rejects.toMatchObject({ kind: 'http', status: 500, retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not retry client errors or 404s', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ error: 'event not found' }, 404))
    const err = await request('/events/nope', undefined).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ kind: 'not-found', retryable: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('maps a network failure to a friendly error kind', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/x', undefined, { retries: 0 })).rejects.toMatchObject({ kind: 'network' })
  })
  it('propagates caller aborts as AbortError, not as an API error', async () => {
    const ctrl = new AbortController()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason))))
    const p = request('/x', undefined, { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('filtersToParams', () => {
  it('repeats agent and omits empty values', () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, q: 'x', agents: ['a', 'b'], status: 'ok' })
    expect(p.toString()).toBe('q=x&agent=a&agent=b&status=ok')
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('')
  })
})
