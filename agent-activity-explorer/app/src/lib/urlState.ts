import { useCallback, useSyncExternalStore } from 'react'
import { EMPTY_FILTERS, STATUSES, type Filters, type Status } from '../api/types'

/** The whole view, as it appears in the address bar. */
export interface ViewState extends Filters {
  /** id of the event whose detail panel is open */
  event: string | null
}

const isIso = (s: string) => !Number.isNaN(Date.parse(s))

export function parseSearch(search: string): ViewState {
  const p = new URLSearchParams(search)
  const status = p.get('status')
  const from = p.get('from')
  const to = p.get('to')
  return {
    q: (p.get('q') ?? '').trim(),
    // de-duplicated and sorted so equal views always produce the same URL
    agents: [...new Set(p.getAll('agent').filter(Boolean))].sort(),
    status: STATUSES.includes(status as Status) ? (status as Status) : null,
    from: from && isIso(from) ? from : null,
    to: to && isIso(to) ? to : null,
    event: p.get('event') || null,
  }
}

export function serializeSearch(v: ViewState): string {
  const p = new URLSearchParams()
  if (v.q) p.set('q', v.q)
  for (const a of [...v.agents].sort()) p.append('agent', a)
  if (v.status) p.set('status', v.status)
  if (v.from) p.set('from', v.from)
  if (v.to) p.set('to', v.to)
  if (v.event) p.set('event', v.event)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const filtersOf = ({ q, agents, status, from, to }: ViewState): Filters => ({ q, agents, status, from, to })

export const filtersKey = (f: Filters) => serializeSearch({ ...f, event: null })

export const hasActiveFilters = (f: Filters) => filtersKey(f) !== filtersKey(EMPTY_FILTERS)

// --- tiny history store -----------------------------------------------------------------
// The address bar is the single source of truth. Components read it through
// useSyncExternalStore and write to it through `navigate`, so refresh, copy/paste of the URL
// and back/forward all behave the same by construction.

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const getSearch = () => window.location.search

export interface NavigateOptions {
  /** replace the current history entry instead of adding one (e.g. while typing) */
  replace?: boolean
  /** tag the new entry as "the one that opened the detail panel" */
  panel?: boolean
}

export function navigate(next: ViewState, { replace = false, panel = false }: NavigateOptions = {}) {
  const url = `${window.location.pathname}${serializeSearch(next)}`
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(panel ? { panelEntry: true } : null, '', url)
  notify()
}

/**
 * Close the panel. If this very history entry was created by opening it, Back is the exact
 * inverse (and keeps the list's history clean). Otherwise (deep link, or filters changed while
 * the panel was open) rewrite in place so Back never undoes something the user didn't ask for.
 */
export function closeEvent() {
  if (window.history.state?.panelEntry) {
    window.history.back()
  } else {
    navigate({ ...parseSearch(window.location.search), event: null }, { replace: true })
  }
}

/** Open (or switch) the panel: first open pushes an entry, switching events reuses it. */
export function openEvent(id: string) {
  const current = parseSearch(window.location.search)
  navigate({ ...current, event: id }, current.event ? { replace: true } : { panel: true })
}

export function useViewState() {
  const search = useSyncExternalStore(subscribe, getSearch)
  // parse is cheap; memoising on the raw string keeps referential stability for effects
  return useMemoParse(search)
}

let lastSearch = ''
let lastParsed: ViewState = parseSearch('')
function useMemoParse(search: string): ViewState {
  if (search !== lastSearch) {
    lastSearch = search
    lastParsed = parseSearch(search)
  }
  return lastParsed
}

export function useNavigate() {
  return useCallback((patch: Partial<ViewState>, opts?: NavigateOptions) => {
    navigate({ ...parseSearch(window.location.search), ...patch }, opts)
  }, [])
}
