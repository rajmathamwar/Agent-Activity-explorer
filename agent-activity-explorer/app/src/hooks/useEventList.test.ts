import { describe, expect, it } from 'vitest'
import type { EventSummary } from '../api/types'
import { reducer, type ListState } from './useEventList'

const ev = (id: string): EventSummary => ({ id, timestamp: '2026-10-09T00:00:00.000Z', agent: 'a', tool: 't', status: 'ok', latencyMs: 1, argsPreview: '{}' })
const loading = reducer(undefined as unknown as ListState, { type: 'reset' })

describe('list reducer', () => {
  it('appends pages and drops duplicate ids', () => {
    let s = reducer(loading, { type: 'first-ok', page: { items: [ev('1'), ev('2')], nextCursor: 'c', total: 10 } })
    s = reducer(s, { type: 'more-start' })
    s = reducer(s, { type: 'more-ok', page: { items: [ev('2'), ev('3')], nextCursor: null, total: 10 } })
    expect(s.items.map((i) => i.id)).toEqual(['1', '2', '3'])
    expect(s.nextCursor).toBeNull()
    expect(s.loadingMore).toBe(false)
  })
  it('keeps loaded rows when a later page fails', () => {
    let s = reducer(loading, { type: 'first-ok', page: { items: [ev('1')], nextCursor: 'c', total: 10 } })
    s = reducer(s, { type: 'more-start' })
    s = reducer(s, { type: 'more-fail', error: new Error('x') as never })
    expect(s.phase).toBe('ready')
    expect(s.items).toHaveLength(1)
    expect(s.moreError).not.toBeNull()
    // trying again clears the error
    expect(reducer(s, { type: 'more-start' }).moreError).toBeNull()
  })
  it('a failed first page is a full error state', () => {
    const s = reducer(loading, { type: 'first-fail', error: new Error('x') as never })
    expect(s.phase).toBe('error')
    expect(s.items).toEqual([])
  })
})
