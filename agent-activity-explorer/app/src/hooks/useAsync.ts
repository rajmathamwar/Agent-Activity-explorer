import { useCallback, useEffect, useState } from 'react'
import { ApiError, isAbort } from '../api/client'

export type AsyncState<T> =
  | { phase: 'loading'; retrying: boolean }
  | { phase: 'ready'; data: T }
  | { phase: 'error'; error: ApiError }

/** Loads `fn(signal, onRetry)` whenever `key` changes; cancels the previous load. */
export function useAsync<T>(
  key: string | null,
  fn: (opts: { signal: AbortSignal; onRetry: () => void }) => Promise<T>,
) {
  const [state, setState] = useState<AsyncState<T>>({ phase: 'loading', retrying: false })
  const [attempt, setAttempt] = useState(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `fn`'s inputs
  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    setState({ phase: 'loading', retrying: false })
    fn({ signal: controller.signal, onRetry: () => setState({ phase: 'loading', retrying: true }) }).then(
      (data) => setState({ phase: 'ready', data }),
      (error) => {
        if (!isAbort(error)) setState({ phase: 'error', error })
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}

/** True once `active` has been true continuously for `ms` (drives "this is slow" messaging). */
export function useSlow(active: boolean, ms = 3000) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return setSlow(false)
    const t = setTimeout(() => setSlow(true), ms)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [active, ms])
  return slow
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
