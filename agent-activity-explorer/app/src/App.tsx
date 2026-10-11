import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DetailPanel } from './components/DetailPanel'
import { EventTable } from './components/EventTable'
import { errorCopy, ListSkeleton, StateMessage } from './components/States'
import { ActiveFilters, AgentFilter, SearchBox, StatusFilter } from './components/Toolbar'
import { useSlow } from './hooks/useAsync'
import { useEventList } from './hooks/useEventList'
import { useMediaQuery } from './hooks/useMediaQuery'
import { formatCount } from './lib/format'
import { closeEvent, filtersOf, hasActiveFilters, openEvent, useNavigate, useViewState } from './lib/urlState'

export default function App() {
  const view = useViewState()
  const navigate = useNavigate()
  const filters = useMemo(() => filtersOf(view), [view])
  const list = useEventList(filters)
  const slow = useSlow(list.phase === 'loading')
  const overlay = useMediaQuery('(max-width: 1099px)')

  const gridRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const panelOpen = view.event !== null

  // Esc closes the panel from anywhere. Popovers call preventDefault() on their own Esc so
  // pressing it inside one only closes that.
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeEvent()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen])

  // Hand focus back to the list when the panel goes away, if focus was inside it.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      const active = document.activeElement
      if (!active || active === document.body || panelRef.current?.contains(active)) gridRef.current?.focus({ preventScroll: true })
    }
    wasOpen.current = panelOpen
  }, [panelOpen])

  const preview = useMemo(() => (view.event ? list.items.find((i) => i.id === view.event) : undefined), [view.event, list.items])
  const onOpen = useCallback((id: string) => openEvent(id), [])
  const filtered = hasActiveFilters(filters)
  const clearAll = () => navigate({ q: '', agents: [], status: null, from: null, to: null })

  let body
  if (list.phase === 'loading') {
    body = <ListSkeleton slow={slow} retrying={list.retrying} />
  } else if (list.phase === 'error') {
    body = (
      <StateMessage
        tone="error"
        title={errorCopy(list.error!, 'events').title}
        action={list.error!.retryable ? <button type="button" className="button button-primary" onClick={list.reload}>Try again</button> : undefined}
      >
        {errorCopy(list.error!, 'events').body}
      </StateMessage>
    )
  } else if (list.items.length === 0) {
    body = filtered ? (
      <StateMessage title="No events match" action={<button type="button" className="button" onClick={clearAll}>Clear all filters</button>}>
        Nothing in the log matches your search and filters. Try a shorter search term or remove a filter.
      </StateMessage>
    ) : (
      <StateMessage title="No events yet">Agent activity will show up here as soon as an agent calls a tool.</StateMessage>
    )
  } else {
    body = (
      <EventTable
        items={list.items}
        total={list.total}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        retrying={list.retrying}
        moreError={list.moreError}
        selectedId={view.event}
        onLoadMore={list.loadMore}
        onOpen={onOpen}
        gridRef={gridRef}
      />
    )
  }

  const inertShell = panelOpen && overlay

  return (
    <div className={`app${panelOpen ? ' has-panel' : ''}`}>
      <div className="shell" inert={inertShell}>
        <header className="topbar">
          <h1 className="brand">Agent Activity</h1>
          <SearchBox q={view.q} />
          <div className="filters">
            <StatusFilter status={view.status} />
            <AgentFilter selected={view.agents} />
          </div>
        </header>
        <div className="subbar">
          <ActiveFilters view={view} />
          <p className="count" role="status" aria-live="polite">
            {list.phase === 'ready' && (
              <>
                <strong>{formatCount(list.total)}</strong> {filtered ? 'matching events' : 'events'}
                {list.items.length < list.total && <span className="muted"> · {formatCount(list.items.length)} loaded</span>}
              </>
            )}
          </p>
        </div>
        <main className="list-region">{body}</main>
      </div>

      {panelOpen && view.event && (
        <>
          {overlay && <div className="scrim" onClick={closeEvent} aria-hidden="true" />}
          <DetailPanel id={view.event} preview={preview} overlay={overlay} onClose={closeEvent} panelRef={panelRef} />
        </>
      )}
    </div>
  )
}
