import type { Status } from '../api/types'

const LABEL: Record<Status, string> = { ok: 'OK', blocked: 'Blocked', error: 'Error' }

/** Colour is never the only signal: each status also has its own glyph and text. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        {status === 'ok' && <path d="M2.5 6.5l2.2 2.2L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
        {status === 'blocked' && (
          <>
            <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.2 8.8l5.6-5.6" stroke="currentColor" strokeWidth="1.6" />
          </>
        )}
        {status === 'error' && <path d="M6 1.8L11 10.5H1L6 1.8zM6 5v2.6M6 8.9v.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {LABEL[status] ?? status}
    </span>
  )
}
