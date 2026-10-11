import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEvent } from '../api/client'
import type { EventDetail, EventSummary } from '../api/types'
import { useAsync, useSlow } from '../hooks/useAsync'
import { formatLatency, formatTimeFull } from '../lib/format'
import { errorCopy, Spinner, StateMessage } from './States'
import { StatusBadge } from './StatusBadge'

/** Beyond this the <pre> is cut off until the user asks for everything (args can be huge). */
const PREVIEW_CHARS = 20_000

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false)
  const text = useMemo(() => JSON.stringify(value, null, 2) ?? 'null', [value])
  const truncated = !expanded && text.length > PREVIEW_CHARS
  return (
    <section className="json-section">
      <h3>{label}</h3>
      <pre className="json" tabIndex={0} aria-label={`${label} JSON`}>{truncated ? text.slice(0, PREVIEW_CHARS) + '\n…' : text}</pre>
      {text.length > PREVIEW_CHARS && (
        <button type="button" className="link-button" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all (${(text.length / 1024).toFixed(0)} KB)`}
        </button>
      )}
    </section>
  )
}

function CopyButton({ getText, children }: { getText: () => string; children: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1800)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button"
      className="button button-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText())
          setDone(true)
        } catch {
          /* clipboard blocked (insecure context / permissions): nothing useful to do */
        }
      }}
    >
      {done ? 'Copied ✓' : children}
      <span className="visually-hidden" role="status">{done ? 'Copied to clipboard' : ''}</span>
    </button>
  )
}

interface Props {
  id: string
  /** what the list already knows, so the header can render before the detail arrives */
  preview?: EventSummary
  onClose: () => void
  overlay: boolean
  panelRef: React.RefObject<HTMLElement | null>
}

export function DetailPanel({ id, preview, onClose, overlay, panelRef }: Props) {
  const { state, retry } = useAsync<EventDetail>(id, ({ signal, onRetry }) => fetchEvent(id, { signal, onRetry }))
  const slow = useSlow(state.phase === 'loading')
  const head: EventSummary | undefined = state.phase === 'ready' ? state.data : preview
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${id} · Agent Activity`
    return () => {
      document.title = 'Agent Activity'
    }
  }, [id])

  // Move focus into the panel when it opens (and when switching events).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [id])

  return (
    <aside
      ref={panelRef}
      className={`panel${overlay ? ' panel-overlay' : ''}`}
      role="dialog"
      aria-modal={overlay}
      aria-labelledby="panel-title"
    >
      <header className="panel-header">
        <div>
          <p className="eyebrow">Event</p>
          <h2 id="panel-title" ref={headingRef} tabIndex={-1} className="panel-title">{id}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details" aria-keyshortcuts="Escape">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>

      <div className="panel-body">
        {head && (
          <dl className="facts">
            <div><dt>Status</dt><dd><StatusBadge status={head.status} /></dd></div>
            <div><dt>Latency</dt><dd className={head.latencyMs >= 5000 ? 'is-slow' : ''}>{formatLatency(head.latencyMs)}</dd></div>
            <div><dt>Agent</dt><dd>{head.agent}</dd></div>
            <div><dt>Tool</dt><dd className="mono">{head.tool}</dd></div>
            <div className="wide">
              <dt>Time</dt>
              <dd>{formatTimeFull(head.timestamp)}<br /><span className="mono muted">{head.timestamp}</span></dd>
            </div>
          </dl>
        )}

        {state.phase === 'loading' && (
          <div role="status" aria-live="polite" className="panel-loading">
            <p className="loading-note">
              <Spinner />
              {state.retrying ? 'The server hiccuped. Trying again…' : slow ? 'Still loading. This event is taking a while…' : 'Loading details…'}
            </p>
            <div className="skeleton-block" aria-hidden="true" />
            <div className="skeleton-block short" aria-hidden="true" />
          </div>
        )}

        {state.phase === 'error' && (
          <StateMessage
            tone="error"
            title={errorCopy(state.error, 'this event').title}
            action={
              <>
                {state.error.retryable && <button type="button" className="button" onClick={retry}>Try again</button>}
                <button type="button" className="button" onClick={onClose}>Close</button>
              </>
            }
          >
            {errorCopy(state.error, 'event').body}
          </StateMessage>
        )}

        {state.phase === 'ready' && (
          <>
            <section className="json-section">
              <h3>Policy matches</h3>
              {state.data.policyMatches?.length ? (
                <ul className="tags">{state.data.policyMatches.map((m) => <li key={m} className="tag">{m}</li>)}</ul>
              ) : (
                <p className="muted">No policy rules fired.</p>
              )}
            </section>
            <JsonBlock label="Arguments" value={state.data.args} />
            <JsonBlock label="Result" value={state.data.result} />
          </>
        )}
      </div>

      <footer className="panel-footer">
        <CopyButton getText={() => window.location.href}>Copy link</CopyButton>
        {state.phase === 'ready' && <CopyButton getText={() => JSON.stringify(state.data, null, 2)}>Copy JSON</CopyButton>}
      </footer>
    </aside>
  )
}
