import type {
  Checkpoint,
  Forecast,
  ForecastSweep,
  Route,
  RouteSummary,
  Trip,
  TripRequest,
  TripTraffic,
} from '../types/api'
import { api } from './apiClient'

// Analysis calls external routing + weather providers, so allow it more time.
export const createTrip = (body: TripRequest) =>
  api<Trip>('/trips/', { method: 'POST', body, timeoutMs: 90000 })

export const health = () =>
  api<{ status: string; database: string; persistent: boolean }>('/health/', { timeoutMs: 5000 })

/** Rebuild a full trip from the server database. Only a fallback: the browser keeps its own
 *  copy of every trip (see utils/tripStore.ts), because a serverless database may be temporary. */
export async function fetchTrip(id: string): Promise<Trip> {
  const [trip, routes, checkpoints] = await Promise.all([
    api<Omit<Trip, 'routes'> & { routes: RouteSummary[] }>(`/trips/${id}/`),
    api<(RouteSummary & { geometry: [number, number][] })[]>(`/trips/${id}/routes/`),
    api<{ route_id: number; checkpoints: Checkpoint[] }[]>(`/trips/${id}/checkpoints/`),
  ])
  const cps = new Map(checkpoints.map((c) => [c.route_id, c.checkpoints]))
  const full: Route[] = routes.map((r) => ({ ...r, checkpoints: cps.get(r.id) ?? [] }))
  return { ...trip, routes: full }
}

/** The inputs of a trip, ready to analyse again (a fresh analysis with the latest forecast). */
export const requestFromTrip = (t: Trip): TripRequest => ({
  origin: { label: t.origin_label, lat: t.origin_lat, lon: t.origin_lon },
  destination: { label: t.destination_label, lat: t.destination_lat, lon: t.destination_lon },
  departure_at: t.departure_at,
  load_weight_lb: t.load_weight_lb,
  checkpoint_interval_miles: t.checkpoint_interval_miles as 10 | 25 | 50,
})

// ---- Stateless endpoints: the request carries the routes, so any server instance can answer.

const routePayload = (t: Trip) =>
  t.routes.map((r) => ({
    id: r.id,
    distance_miles: r.distance_miles,
    duration_minutes: r.duration_minutes,
    checkpoints: r.checkpoints.map((c) => ({
      sequence: c.sequence,
      distance_miles: c.distance_miles,
      lat: c.lat,
      lon: c.lon,
      eta: c.eta,
    })),
  }))

/** Weather and risk for one delayed departure. */
export const getForecast = (t: Trip, offsetHours: number) =>
  api<Forecast>('/forecast/', {
    method: 'POST',
    body: { load_weight_lb: t.load_weight_lb, offset_hours: offsetHours, routes: routePayload(t) },
    timeoutMs: 45000,
  })

/** Route summaries for many departures in one request (one weather fetch, not one per offset). */
export const getForecastSweep = (t: Trip, offsets: number[]) =>
  api<ForecastSweep>('/forecast/sweep/', {
    method: 'POST',
    body: { load_weight_lb: t.load_weight_lb, offsets, routes: routePayload(t) },
    timeoutMs: 60000,
  })

/** At most `n` evenly spaced points: enough for the server to match roads. */
const thin = (pts: [number, number][], n = 120) => {
  const step = Math.max(1, Math.ceil(pts.length / n))
  const out = pts.filter((_, i) => i % step === 0)
  const last = pts[pts.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

export const getTraffic = (t: Trip, offsetHours: number) =>
  api<TripTraffic>('/traffic/routes/', {
    method: 'POST',
    body: {
      origin: { lat: t.origin_lat, lon: t.origin_lon },
      destination: { lat: t.destination_lat, lon: t.destination_lon },
      departure_at: t.departure_at,
      offset_hours: offsetHours,
      routes: t.routes.map((r) => ({ id: r.id, geometry: thin(r.geometry) })),
    },
    timeoutMs: 30000,
  })
