import type { Checkpoint, Forecast, Route, RouteSummary, Trip, TripRequest, TripTraffic } from '../types/api'
import { api } from './apiClient'

// Analysis calls external routing + weather providers, so allow it more time.
export const createTrip = (body: TripRequest) =>
  api<Trip>('/trips/', { method: 'POST', body, timeoutMs: 90000 })

export const reanalyzeTrip = (id: string) =>
  api<Trip>(`/trips/${id}/reanalyze/`, { method: 'POST', timeoutMs: 90000 })

export const getForecast = (id: string, offsetHours: number) =>
  api<Forecast>(`/trips/${id}/forecast/?offset_hours=${offsetHours}`, { timeoutMs: 30000 })

export const health = () =>
  api<{ status: string; database: string; persistent: boolean }>('/health/', { timeoutMs: 5000 })

/** Rebuild a full trip from the database (used when reopening a saved trip). */
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

export const getTraffic = (id: string, offsetHours: number) =>
  api<TripTraffic>(`/trips/${id}/traffic/?offset_hours=${offsetHours}`, { timeoutMs: 30000 })
