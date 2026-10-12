import type { Trip } from '../types/api'

// The analysis is kept in this browser so reopening a trip never depends on the server still
// holding it (a serverless database can be a temporary file). Keys are per trip id.
const key = (id: string) => `wa:trip:${id}`
const MAX_POINTS = 2500

/** Keep the map polyline light enough for localStorage; checkpoints are unaffected. */
function lighten(trip: Trip): Trip {
  return {
    ...trip,
    routes: trip.routes.map((r) => {
      if (r.geometry.length <= MAX_POINTS) return r
      const step = Math.ceil(r.geometry.length / MAX_POINTS)
      const g = r.geometry.filter((_, i) => i % step === 0)
      g.push(r.geometry[r.geometry.length - 1])
      return { ...r, geometry: g }
    }),
  }
}

export function saveTrip(trip: Trip) {
  try {
    localStorage.setItem(key(trip.trip_id), JSON.stringify(lighten(trip)))
  } catch {
    /* quota or disabled storage: the app still works from memory and the server copy */
  }
}

export function loadTrip(id: string): Trip | null {
  try {
    const raw = localStorage.getItem(key(id))
    return raw ? (JSON.parse(raw) as Trip) : null
  } catch {
    return null
  }
}

export function removeTrip(id: string) {
  try {
    localStorage.removeItem(key(id))
  } catch {
    /* nothing to do */
  }
}
