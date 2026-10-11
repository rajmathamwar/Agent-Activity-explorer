import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ApiError } from '../api/client'
import type { EventSummary } from '../api/types'
import { formatCount, formatLatency, formatTime } from '../lib/format'
import { clamp, computeRange, scrollToReveal } from '../lib/virtual'
import { Spinner } from './States'
import { StatusBadge } from './StatusBadge'

export const ROW_HEIGHT = 40
export const HEADER_HEIGHT = 36
const FOOTER_HEIGHT = 56
/** start fetching the next page when the rendered window gets this close to the end */
const PREFETCH_ROWS = 30
const PAGE_JUMP_ROWS = 10

interface RowProps {
  event: EventSummary
  index: number
  active: boolean
  selected: boolean
  onOpen: (id: string, index: number) => void
}

const Row = memo(function Row({ event, index, active, selected, onOpen }: RowProps) {
  return (
    <div
      role="row"
      id={`row-${event.id}`}
      aria-rowindex={index + 2} // the header row is 1
      aria-selected={selected}
      className={`row${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
      style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
      onClick={() => onOpen(event.id, index)}
    >
      <div role="gridcell" className="cell cell-time" title={event.timestamp}>{formatTime(event.timestamp)}</div>
      <div role="gridcell" className="cell cell-agent">{event.agent}</div>
      <div role="gridcell" className="cell cell-tool">{event.tool}</div>
      <div role="gridcell" className="cell cell-status"><StatusBadge status={event.status} /></div>
      <div role="gridcell" className={`cell cell-latency${event.latencyMs >= 5000 ? ' is-slow' : ''}`}>{formatLatency(event.latencyMs)}</div>
      <div role="gridcell" className="cell cell-args" title={event.argsPreview}>{event.argsPreview}</div>
    </div>
  )
})

interface Props {
  items: EventSummary[]
  total: number
  hasMore: boolean
  loadingMore: boolean
  retrying: boolean
  moreError: ApiError | null
  selectedId: string | null
  onLoadMore: () => void
  onOpen: (id: string) => void
  /** the grid element, so the app can hand focus back after the panel closes */
  gridRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Hand-built windowed table. Only the rows intersecting the viewport (plus a little overscan)
 * exist in the DOM, however many pages have been loaded. Rows are fixed-height and absolutely
 * positioned, so the visible range is plain arithmetic (see lib/virtual.ts).
 */
export function EventTable({ items, total, hasMore, loadingMore, retrying, moreError, selectedId, onLoadMore, onOpen, gridRef }: Props) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [activeIndex, setActiveIndex] = useState(0)
  const frame = useRef(0)

  // viewport size (also reacts to the side panel docking/undocking)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [gridRef])

  const onScroll = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (gridRef.current) setScrollTop(gridRef.current.scrollTop)
    })
  }, [gridRef])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const range = computeRange({ scrollTop, viewportHeight, rowHeight: ROW_HEIGHT, rowCount: items.length, headerHeight: HEADER_HEIGHT })

  // Fetch ahead of the user. Re-runs after every page, so a tall viewport keeps filling.
  useEffect(() => {
    if (hasMore && !loadingMore && !moreError && range.end >= items.length - PREFETCH_ROWS) onLoadMore()
  }, [hasMore, loadingMore, moreError, range.end, items.length, onLoadMore])

  const reveal = useCallback(
    (index: number) => {
      const el = gridRef.current
      if (!el) return
      const next = scrollToReveal(index, { scrollTop: el.scrollTop, viewportHeight: el.clientHeight, rowHeight: ROW_HEIGHT, headerHeight: HEADER_HEIGHT })
      if (next !== null) el.scrollTop = next
    },
    [gridRef],
  )

  const moveTo = (index: number) => {
    const i = clamp(index, 0, items.length - 1)
    setActiveIndex(i)
    reveal(i)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    const page = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1) || PAGE_JUMP_ROWS
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        return moveTo(activeIndex + 1), e.preventDefault()
      case 'ArrowUp':
      case 'k':
        return moveTo(activeIndex - 1), e.preventDefault()
      case 'PageDown':
        return moveTo(activeIndex + page), e.preventDefault()
      case 'PageUp':
        return moveTo(activeIndex - page), e.preventDefault()
      case 'Home':
        return moveTo(0), e.preventDefault()
      case 'End':
        return moveTo(items.length - 1), e.preventDefault()
      case 'Enter':
      case ' ':
        if (items[activeIndex]) onOpen(items[activeIndex].id)
        return e.preventDefault()
    }
  }

  const handleOpen = useCallback(
    (id: string, index: number) => {
      setActiveIndex(index)
      onOpen(id)
    },
    [onOpen],
  )

  const active = items[activeIndex]
  const visible = items.slice(range.start, range.end)

  return (
    <div
      ref={gridRef}
      className="grid-scroller"
      role="grid"
      aria-label="Agent events"
      aria-rowcount={total + 1}
      aria-colcount={6}
      aria-activedescendant={active ? `row-${active.id}` : undefined}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      style={{ '--row-h': `${ROW_HEIGHT}px`, '--header-h': `${HEADER_HEIGHT}px` } as React.CSSProperties}
    >
      <div role="row" aria-rowindex={1} className="row row-header">
        <div role="columnheader" className="cell cell-time">Time</div>
        <div role="columnheader" className="cell cell-agent">Agent</div>
        <div role="columnheader" className="cell cell-tool">Tool</div>
        <div role="columnheader" className="cell cell-status">Status</div>
        <div role="columnheader" className="cell cell-latency">Latency</div>
        <div role="columnheader" className="cell cell-args">Arguments</div>
      </div>
      <div className="grid-body" role="rowgroup" style={{ height: items.length * ROW_HEIGHT + FOOTER_HEIGHT }}>
        {visible.map((event, i) => (
          <Row key={event.id} event={event} index={range.start + i} active={range.start + i === activeIndex} selected={event.id === selectedId} onOpen={handleOpen} />
        ))}
        <div className="grid-footer" style={{ transform: `translateY(${items.length * ROW_HEIGHT}px)`, height: FOOTER_HEIGHT }}>
          {moreError ? (
            <p role="alert">
              Couldn’t load more events. <button type="button" className="button button-small" onClick={onLoadMore}>Try again</button>
            </p>
          ) : loadingMore || hasMore ? (
            <p role="status">
              <Spinner /> {retrying ? 'The server hiccuped. Trying again…' : 'Loading more…'}
            </p>
          ) : (
            <p>End of results · {formatCount(items.length)} events</p>
          )}
        </div>
      </div>
    </div>
  )
}
