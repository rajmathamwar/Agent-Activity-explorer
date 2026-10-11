const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
})

const full = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  timeZoneName: 'short',
})

export const formatTime = (iso: string) => dateTime.format(new Date(iso))
export const formatTimeFull = (iso: string) => full.format(new Date(iso))

export function formatLatency(ms: number) {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${ms} ms`
}

export const formatCount = (n: number) => n.toLocaleString()
