import { beforeEach, describe, expect, it } from 'vitest'
import { closeEvent, navigate, openEvent, parseSearch, serializeSearch } from './urlState'

describe('parse/serialize', () => {
  it('round-trips a full view', () => {
    const v = parseSearch('?q=stripe&agent=b&agent=a&status=error&event=evt_1')
    expect(v).toMatchObject({ q: 'stripe', agents: ['a', 'b'], status: 'error', event: 'evt_1' })
    expect(parseSearch(serializeSearch(v))).toEqual(v)
  })
  it('is canonical: agent order and duplicates do not change the URL', () => {
    expect(serializeSearch(parseSearch('?agent=b&agent=a&agent=b'))).toBe('?agent=a&agent=b')
  })
  it('drops values the API would reject instead of sending them', () => {
    const v = parseSearch('?status=bogus&from=nope&to=2026-10-09T00:00:00Z&q=%20%20')
    expect(v.status).toBeNull()
    expect(v.from).toBeNull()
    expect(v.to).toBe('2026-10-09T00:00:00Z')
    expect(v.q).toBe('')
  })
  it('keeps special characters in search intact', () => {
    const v = parseSearch(serializeSearch({ ...parseSearch(''), q: 'a&b=c #1' }))
    expect(v.q).toBe('a&b=c #1')
  })
  it('an empty view has an empty query string', () => {
    expect(serializeSearch(parseSearch(''))).toBe('')
  })
})

describe('history behaviour', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })
  const view = () => parseSearch(window.location.search)

  it('opening the panel pushes one entry; switching events reuses it', () => {
    const start = window.history.length
    openEvent('evt_a')
    openEvent('evt_b')
    expect(window.history.length).toBe(start + 1)
    expect(view().event).toBe('evt_b')
  })
  it('closing a deep-linked panel rewrites in place instead of leaving the app', () => {
    window.history.replaceState(null, '', '/?q=x&event=evt_a')
    const len = window.history.length
    closeEvent()
    expect(view()).toMatchObject({ q: 'x', event: null })
    expect(window.history.length).toBe(len)
  })
  it('replace navigation does not add history entries (typing)', () => {
    const len = window.history.length
    navigate({ ...view(), q: 'a' }, { replace: true })
    navigate({ ...view(), q: 'ab' }, { replace: true })
    expect(window.history.length).toBe(len)
    expect(view().q).toBe('ab')
  })
})
