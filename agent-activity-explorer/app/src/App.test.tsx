import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mk = (i: number) => ({
  id: `evt_${i}`,
  timestamp: new Date(Date.UTC(2026, 9, 9, 12, 0, 0) - i * 1000).toISOString(),
  agent: i % 2 ? 'data-analyst' : 'code-reviewer',
  tool: 'sql.query',
  status: 'ok',
  latencyMs: 10 + i,
  argsPreview: '{}',
})

function mockApi() {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const body = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    if (url.pathname === '/agents') return body(['code-reviewer', 'data-analyst'])
    if (url.pathname.startsWith('/events/')) {
      const id = decodeURIComponent(url.pathname.split('/')[2])
      if (id === 'evt_missing') return body({ error: 'event not found' }, 404)
      return body({ ...mk(Number(id.split('_')[1])), args: { hello: 'world' }, result: { ok: true }, policyMatches: ['no-pii'] })
    }
    if (url.searchParams.get('q') === 'nothing') return body({ items: [], nextCursor: null, total: 0 })
    return body({ items: Array.from({ length: 5 }, (_, i) => mk(i)), nextCursor: null, total: 5 })
  })
  return calls
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  // jsdom has no layout or ResizeObserver
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
})
afterEach(() => vi.restoreAllMocks())

describe('App', () => {
  it('shows a loading state, then rows', async () => {
    mockApi()
    render(<App />)
    expect(screen.getByText(/Loading events/)).toBeInTheDocument()
    expect(await screen.findAllByRole('row')).not.toHaveLength(0)
    expect(await screen.findByText('5')).toBeInTheDocument()
  })

  it('reflects filters in the URL and sends them to the API', async () => {
    const calls = mockApi()
    render(<App />)
    await screen.findAllByRole('gridcell')
    await userEvent.click(screen.getByRole('radio', { name: 'Error' }))
    await waitFor(() => expect(window.location.search).toBe('?status=error'))
    await waitFor(() => expect(calls.some((c) => c.includes('status=error'))).toBe(true))
  })

  it('opens the panel from a row, and Escape closes it', async () => {
    mockApi()
    render(<App />)
    const cells = await screen.findAllByRole('gridcell')
    await userEvent.click(cells[0])
    const dialog = await screen.findByRole('dialog')
    expect(window.location.search).toContain('event=evt_0')
    expect(await within(dialog).findByText('no-pii')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens a panel straight from a URL and handles an unknown id', async () => {
    mockApi()
    window.history.replaceState(null, '', '/?event=evt_missing')
    render(<App />)
    expect(await screen.findByText('Not found')).toBeInTheDocument()
  })

  it('shows an empty state with a way out', async () => {
    mockApi()
    window.history.replaceState(null, '', '/?q=nothing')
    render(<App />)
    expect(await screen.findByText('No events match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('shows an error state with retry when the API is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText(/reach the server/, undefined, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  }, 12000)
})
