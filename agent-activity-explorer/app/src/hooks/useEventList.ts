import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ApiError, fetchEvents, isAbort } from '../api/client'
import type { EventSummary, EventsPage, Filters } from '../api/types'
import { filtersKey } from '../lib/urlState'

export interface ListState {
  phase: 'loading' | 'ready' | 'error'
  items: EventSummary[]
  total: number
  nextCursor: string | null
  /** a follow-up page is being fetched */
  loadingMore: boolean
  /** the follow-up page failed (the rows we already have stay on screen) */
  moreError: ApiError | null
  error: ApiError | null
  /** automatic retries in flight, so the UI can say "retrying" */
  retrying: boolean
}

const initial: ListState = {
  phase: 'loading',
  items: [],
  total: 0,
  nextCursor: null,
  loadingMore: false,
  moreError: null,
  error: null,
  retrying: false,
}

type Action =
  | { type: 'reset' }
  | { type: 'first-ok'; page: EventsPage }
  | { type: 'first-fail'; error: ApiError }
  | { type: 'more-start' }
  | { type: 'more-ok'; page: EventsPage }
  | { type: 'more-fail'; error: ApiError }
  | { type: 'retrying'; value: boolean }

export function reducer(state: ListState, action: Action): ListState {
  switch (action.type) {
    case 'reset':
      return initial
    case 'first-ok':
      return { ...initial, phase: 'ready', items: action.page.items, total: action.page.total, nextCursor: action.page.nextCursor }
    case 'first-fail':
      return { ...initial, phase: 'error', error: action.error }
    case 'more-start':
      return { ...state, loadingMore: true, moreError: null }
    case 'more-ok': {
      // keyset pagination shouldn't overlap, but a duplicate id would break React keys and
      // row identity, so be defensive.
      const seen = new Set(state.items.map((i) => i.id))
      const fresh = action.page.items.filter((i) => !seen.has(i.id))
      return {
        ...state,
        items: fresh.length ? state.items.concat(fresh) : state.items,
        total: action.page.total,
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        retrying: false,
      }
    }
    case 'more-fail':
      return { ...state, loadingMore: false, moreError: action.error, retrying: false }
    case 'retrying':
      return { ...state, retrying: action.value }
  }
}

/**
 * Cursor-paginated events for a set of filters. Changing the filters cancels whatever is in
 * flight and starts over; responses from a superseded query can never land in the list.
 */
export function useEventList(filters: Filters) {
  const [state, dispatch] = useReducer(reducer, initial)
  const key = filtersKey(filters)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const stateRef = useRef(state)
  stateRef.current = state
  const controllerRef = useRef<AbortController | null>(null)

  const loadFirst = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'reset' })
    fetchEvents(filtersRef.current, null, {
      signal: controller.signal,
      onRetry: () => dispatch({ type: 'retrying', value: true }),
    }).then(
      (page) => dispatch({ type: 'first-ok', page }),
      (error) => {
        if (!isAbort(error)) dispatch({ type: 'first-fail', error })
      },
    )
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised filters
  useEffect(() => {
    loadFirst()
    return () => controllerRef.current?.abort()
  }, [key, loadFirst])

  const loadMore = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'ready' || s.loadingMore || !s.nextCursor) return
    const controller = controllerRef.current
    if (!controller || controller.signal.aborted) return
    dispatch({ type: 'more-start' })
    fetchEvents(filtersRef.current, s.nextCursor, {
      signal: controller.signal,
      onRetry: () => dispatch({ type: 'retrying', value: true }),
    }).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: 'more-ok', page })
      },
      (error) => {
        if (!isAbort(error)) dispatch({ type: 'more-fail', error })
      },
    )
  }, [])

  return { ...state, loadMore, reload: loadFirst, hasMore: state.nextCursor !== null }
}
