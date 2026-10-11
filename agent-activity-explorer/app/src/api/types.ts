export type Status = 'ok' | 'blocked' | 'error'
export const STATUSES: readonly Status[] = ['ok', 'blocked', 'error']

export interface EventSummary {
  id: string
  timestamp: string
  agent: string
  tool: string
  status: Status
  latencyMs: number
  argsPreview: string
}

export interface EventDetail extends EventSummary {
  args: unknown
  result: unknown
  policyMatches: string[]
}

export interface EventsPage {
  items: EventSummary[]
  nextCursor: string | null
  total: number
}

/** Everything that defines "which events the user is looking at". */
export interface Filters {
  q: string
  agents: string[]
  status: Status | null
  from: string | null
  to: string | null
}

export const EMPTY_FILTERS: Filters = { q: '', agents: [], status: null, from: null, to: null }
