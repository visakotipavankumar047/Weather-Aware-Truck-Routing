export const miles = (n: number) => `${n >= 100 ? Math.round(n) : n.toFixed(1)} mi`

export function duration(minutes: number) {
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const timeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export const tzName = () =>
  new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? ''

/** `<input type="datetime-local">` value (local wall time) for a Date. */
export function toLocalInput(d: Date) {
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return shifted.toISOString().slice(0, 16)
}

export const num = (n: number, digits = 1) => n.toFixed(digits)
