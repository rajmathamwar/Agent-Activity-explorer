import type { ReactNode } from 'react'
import type { ApiError } from '../api/client'

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function errorCopy(error: ApiError, what: string) {
  switch (error.kind) {
    case 'network':
      return { title: `Couldn't reach the server`, body: `Check that the API is running and your connection is up, then try again.` }
    case 'timeout':
      return { title: `The server took too long`, body: `Loading ${what} timed out. It may be under load.` }
    case 'not-found':
      return { title: `Not found`, body: `This ${what} doesn't exist, or it has been removed.` }
    default:
      return { title: `Couldn't load ${what}`, body: error.status ? `The server responded with ${error.status}${error.message ? `: ${error.message}` : ''}.` : error.message }
  }
}

interface StateProps {
  title: string
  children?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'error'
}

/** Centered message block used for empty and error states. */
export function StateMessage({ title, children, action, tone = 'neutral' }: StateProps) {
  return (
    <div className={`state state-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <h2 className="state-title">{title}</h2>
      {children && <p className="state-body">{children}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

/** Placeholder rows shown while the first page loads. */
export function ListSkeleton({ slow, retrying }: { slow: boolean; retrying: boolean }) {
  return (
    <div className="skeleton-wrap" role="status" aria-live="polite">
      <p className="loading-note">
        <Spinner />
        {retrying
          ? 'The server hiccuped. Trying again…'
          : slow
            ? 'Still loading. The server is responding slowly…'
            : 'Loading events…'}
      </p>
      <div aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <div className="skeleton-row" key={i}>
            <span style={{ width: 130 }} />
            <span style={{ width: 110 + ((i * 37) % 50) }} />
            <span style={{ width: 90 + ((i * 53) % 70) }} />
            <span style={{ width: 54 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
