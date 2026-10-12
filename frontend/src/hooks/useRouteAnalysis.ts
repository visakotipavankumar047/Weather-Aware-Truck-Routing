import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError } from '../services/apiClient'
import {
  createTrip,
  fetchTrip,
  getForecast,
  getForecastSweep,
  getTraffic,
  requestFromTrip,
} from '../services/trips'
import type { Route, RouteSummary, Trip } from '../types/api'
import { loadTrip, removeTrip, saveTrip } from '../utils/tripStore'

export const STRIP_OFFSETS = Array.from({ length: 16 }, (_, i) => (i + 1) * 3) // +3h .. +48h

const retryTransient = (count: number, e: unknown) => count < 1 && e instanceof ApiError && e.retryable

/** A saved trip: this browser's copy first, the server only as a fallback. */
export function useTrip(id: string | null) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: async () => loadTrip(id as string) ?? (await fetchTrip(id as string)),
    enabled: !!id,
    staleTime: Infinity,
    retry: retryTransient,
  })
}

export function useCreateTrip(onCreated: (t: Trip) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTrip,
    onSuccess: (trip) => {
      saveTrip(trip)
      qc.setQueryData(['trip', trip.trip_id], trip)
      onCreated(trip)
    },
  })
}

/** Analyse the same inputs again with the latest forecast. Produces a new trip id; the old copy is
 *  dropped. (Done as a fresh analysis so it works no matter which server instance answers.) */
export function useReanalyze(onDone: (oldId: string, t: Trip) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trip: Trip) => createTrip(requestFromTrip(trip)),
    onSuccess: (trip, old) => {
      saveTrip(trip)
      qc.setQueryData(['trip', trip.trip_id], trip)
      qc.removeQueries({ queryKey: ['forecast', old.trip_id] })
      qc.removeQueries({ queryKey: ['sweep', old.trip_id] })
      qc.removeQueries({ queryKey: ['traffic', old.trip_id] })
      removeTrip(old.trip_id)
      onDone(old.trip_id, trip)
    },
  })
}

export function useForecast(trip: Trip | undefined, offset: number) {
  return useQuery({
    queryKey: ['forecast', trip?.trip_id, offset],
    queryFn: () => getForecast(trip as Trip, offset),
    enabled: !!trip && offset > 0,
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: retryTransient,
  })
}

/** The trip as it looks at the selected forecast offset (geometry from the trip, risk from the forecast). */
export function useTripView(trip: Trip | undefined, offset: number) {
  const forecast = useForecast(trip, offset)
  const data = offset > 0 ? forecast.data : undefined
  const routes: Route[] = useMemo(() => {
    if (!trip) return []
    if (!data) return trip.routes
    return trip.routes.map((r) => {
      const f = data.routes.find((x) => x.id === r.id)
      return f
        ? { ...r, rank: f.rank, eligible: f.eligible, risk_summary: f.risk_summary, checkpoints: f.checkpoints }
        : r
    })
  }, [trip, data])
  return {
    routes,
    recommendedRouteId: data ? data.recommended_route_id : (trip?.recommended_route_id ?? null),
    loading: offset > 0 && forecast.isFetching,
    error: offset > 0 ? forecast.error : null,
    refetch: forecast.refetch,
    // true when what is on screen belongs to a different offset than requested
    stale: offset > 0 && (!data || data.offset_hours !== offset),
    shownOffset: data ? data.offset_hours : 0,
  }
}

/** Per-offset route summaries for the heat strip, fetched in ONE request. */
export function useForecastStrip(trip: Trip | undefined) {
  const q = useQuery({
    queryKey: ['sweep', trip?.trip_id],
    queryFn: () => getForecastSweep(trip as Trip, [0, ...STRIP_OFFSETS]),
    enabled: !!trip,
    staleTime: 10 * 60 * 1000,
    retry: retryTransient,
  })
  const byOffset = new Map<number, RouteSummary[]>((q.data?.offsets ?? []).map((o) => [o.offset_hours, o.routes]))
  return STRIP_OFFSETS.map((offset) => ({
    offset,
    data: byOffset.has(offset) ? { routes: byOffset.get(offset) as RouteSummary[] } : undefined,
  }))
}

/** Traffic-aware delay and congested sections for the departure offset on screen. Non-critical:
 *  failures just mean no traffic detail, never a broken page. */
export function useTripTraffic(trip: Trip | undefined, offset: number, enabled: boolean) {
  return useQuery({
    queryKey: ['traffic', trip?.trip_id, offset],
    queryFn: () => getTraffic(trip as Trip, offset),
    enabled: !!trip && enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
