import type { Place } from '../types/api'

const KEY = 'wa:recent-places'

export function loadRecent(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Place[]
  } catch {
    return []
  }
}

export function rememberPlace(p: Place) {
  try {
    const next = [p, ...loadRecent().filter((r) => r.label !== p.label)].slice(0, 6)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
}
