import { describe, expect, it } from 'vitest'
import { computeRange, scrollToReveal } from './virtual'

const base = { rowHeight: 40, viewportHeight: 436, headerHeight: 36, overscan: 2 }

describe('computeRange', () => {
  it('renders the first screenful plus overscan at the top', () => {
    // visible body height = 400 => rows 0..9, +2 overscan below
    expect(computeRange({ ...base, scrollTop: 0, rowCount: 1000 })).toEqual({ start: 0, end: 12 })
  })
  it('moves the window with scrollTop', () => {
    expect(computeRange({ ...base, scrollTop: 4000, rowCount: 1000 })).toEqual({ start: 98, end: 112 })
  })
  it('never exceeds the row count', () => {
    expect(computeRange({ ...base, scrollTop: 99999, rowCount: 50 })).toEqual({ start: 50, end: 50 })
    expect(computeRange({ ...base, scrollTop: 0, rowCount: 5 })).toEqual({ start: 0, end: 5 })
  })
  it('handles an empty list', () => {
    expect(computeRange({ ...base, scrollTop: 0, rowCount: 0 })).toEqual({ start: 0, end: 0 })
  })
  it('renders a bounded number of rows regardless of list size', () => {
    const r = computeRange({ ...base, scrollTop: 123456, rowCount: 1_000_000 })
    expect(r.end - r.start).toBeLessThan(20)
  })
})

describe('scrollToReveal', () => {
  const o = { scrollTop: 400, viewportHeight: 436, rowHeight: 40, headerHeight: 36 }
  it('returns null when the row is already fully visible', () => {
    expect(scrollToReveal(12, o)).toBeNull()
  })
  it('scrolls up so a row above the viewport sits at the top', () => {
    expect(scrollToReveal(5, o)).toBe(200)
  })
  it('scrolls down so a row below the viewport sits at the bottom', () => {
    expect(scrollToReveal(30, o)).toBe(30 * 40 + 40 - 400)
  })
  it('never returns a negative scrollTop', () => {
    expect(scrollToReveal(0, { ...o, scrollTop: 10 })).toBe(0)
  })
})
