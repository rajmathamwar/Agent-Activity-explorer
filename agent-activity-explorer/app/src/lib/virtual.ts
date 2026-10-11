export interface RangeInput {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  rowCount: number
  /** extra rows rendered above and below the viewport so fast scrolling doesn't flash blank */
  overscan?: number
  /** height of anything that sits above the first row inside the scroller (sticky header) */
  headerHeight?: number
}

export interface Range {
  /** first row to render (inclusive) */
  start: number
  /** last row to render (exclusive) */
  end: number
}

/** Which rows intersect the viewport (plus overscan). Pure, so it's easy to test. */
export function computeRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  rowCount,
  overscan = 6,
  headerHeight = 0,
}: RangeInput): Range {
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  // Body coordinates: the sticky header permanently covers the first `headerHeight` px of the
  // viewport, so the visible slice of the body is [scrollTop, scrollTop + viewport - header].
  const top = Math.max(0, scrollTop)
  const bottom = Math.max(0, scrollTop + viewportHeight - headerHeight)
  const first = Math.floor(top / rowHeight)
  const last = Math.ceil(bottom / rowHeight)
  return {
    start: Math.min(rowCount, Math.max(0, first - overscan)),
    end: Math.min(rowCount, Math.max(0, last + overscan)),
  }
}

/**
 * New scrollTop that brings row `index` fully into view with the least movement, or null if it
 * already is. Coordinates are relative to the body (the rows), see computeRange.
 */
export function scrollToReveal(
  index: number,
  { scrollTop, viewportHeight, rowHeight, headerHeight = 0 }: Pick<RangeInput, 'scrollTop' | 'viewportHeight' | 'rowHeight' | 'headerHeight'>,
): number | null {
  const rowTop = index * rowHeight
  const rowBottom = rowTop + rowHeight
  const visibleHeight = viewportHeight - headerHeight
  if (rowTop < scrollTop) return Math.max(0, rowTop)
  if (rowBottom > scrollTop + visibleHeight) return Math.max(0, rowBottom - visibleHeight)
  return null
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
