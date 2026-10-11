import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { fetchAgents } from '../api/client'
import { STATUSES, type Status } from '../api/types'
import { useAsync } from '../hooks/useAsync'
import { useNavigate, type ViewState } from '../lib/urlState'
import { errorCopy, Spinner } from './States'

const SEARCH_DEBOUNCE_MS = 300

export function SearchBox({ q }: { q: string }) {
  const navigate = useNavigate()
  const [text, setText] = useState(q)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The first commit of a typing burst adds a history entry (so Back can undo the search);
  // later commits in the same burst rewrite it, so Back doesn't replay every keystroke.
  const pushedThisBurst = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Back/forward or a pasted URL changed `q`: show it.
  useEffect(() => setText(q), [q])

  const commit = useCallback(
    (value: string) => {
      clearTimeout(timer.current)
      const next = value.trim()
      navigate({ q: next }, { replace: pushedThisBurst.current })
      pushedThisBurst.current = true
    },
    [navigate],
  )

  useEffect(() => () => clearTimeout(timer.current), [])

  // "/" focuses search, like most developer tools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={text}
        placeholder="Search agent, tool or arguments"
        aria-label="Search events"
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(e.target.value), SEARCH_DEBOUNCE_MS)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text)
          // Esc clears a non-empty search; on an empty one it falls through (e.g. closes the panel)
          if (e.key === 'Escape' && text) {
            e.preventDefault()
            setText('')
            commit('')
          }
        }}
        onBlur={() => {
          if (timer.current) commit(text) // don't lose a half-debounced edit
          pushedThisBurst.current = false
        }}
      />
      <kbd className="search-hint" aria-hidden="true">/</kbd>
    </div>
  )
}

export function StatusFilter({ status }: { status: Status | null }) {
  const navigate = useNavigate()
  const name = useId()
  const options: { value: Status | null; label: string }[] = [{ value: null, label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s === 'ok' ? 'OK' : s[0].toUpperCase() + s.slice(1) }))]
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">Status</legend>
      {options.map((o) => (
        <label key={o.label} className={`segment ${o.value ? `segment-${o.value}` : ''}`}>
          <input type="radio" name={name} checked={status === o.value} onChange={() => navigate({ status: o.value })} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function AgentFilter({ selected }: { selected: string[] }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { state, retry } = useAsync(open ? 'agents' : null, ({ signal, onRetry }) => fetchAgents({ signal, onRetry }))
  // keep the list once loaded so re-opening is instant
  const [agents, setAgents] = useState<string[] | null>(null)
  useEffect(() => {
    if (state.phase === 'ready') setAgents(state.data)
  }, [state])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const toggle = (agent: string) => {
    const next = selected.includes(agent) ? selected.filter((a) => a !== agent) : [...selected, agent]
    navigate({ agents: next })
  }

  const list = agents ?? []
  // agents from the URL that the API doesn't know about must still be visible and removable
  const extra = selected.filter((a) => !list.includes(a))

  return (
    <div
      className="agent-filter"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault() // so the global "Esc closes the panel" handler ignores it
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Agents
        {selected.length > 0 && <span className="count-pill">{selected.length}</span>}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="popover" id={panelId} role="group" aria-label="Filter by agent">
          {!agents && state.phase === 'loading' && (
            <p className="popover-note"><Spinner /> Loading agents…</p>
          )}
          {!agents && state.phase === 'error' && (
            <div className="popover-note" role="alert">
              <p>{errorCopy(state.error, 'agents').title}.</p>
              <button type="button" className="button button-small" onClick={retry}>Try again</button>
            </div>
          )}
          {(agents || extra.length > 0) && (
            <ul className="checklist">
              {[...extra, ...list].map((a) => (
                <li key={a}>
                  <label>
                    <input type="checkbox" checked={selected.includes(a)} onChange={() => toggle(a)} />
                    <span>{a}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {selected.length > 0 && (
            <button type="button" className="link-button" onClick={() => navigate({ agents: [] })}>Clear agents</button>
          )}
        </div>
      )}
    </div>
  )
}

export function ActiveFilters({ view }: { view: ViewState }) {
  const navigate = useNavigate()
  const chips: { key: string; label: string; remove: () => void }[] = []
  if (view.q) chips.push({ key: 'q', label: `Search: “${view.q}”`, remove: () => navigate({ q: '' }) })
  for (const a of view.agents) chips.push({ key: `a:${a}`, label: a, remove: () => navigate({ agents: view.agents.filter((x) => x !== a) }) })
  if (view.status) chips.push({ key: 's', label: `Status: ${view.status}`, remove: () => navigate({ status: null }) })
  if (view.from || view.to) {
    const f = (s: string | null) => (s ? new Date(s).toLocaleString() : '…')
    chips.push({ key: 't', label: `${f(view.from)} → ${f(view.to)}`, remove: () => navigate({ from: null, to: null }) })
  }
  if (!chips.length) return null
  return (
    <ul className="chips" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.key} className="chip">
          <span>{c.label}</span>
          <button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.remove}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </li>
      ))}
      <li>
        <button type="button" className="link-button" onClick={() => navigate({ q: '', agents: [], status: null, from: null, to: null })}>
          Clear all
        </button>
      </li>
    </ul>
  )
}
