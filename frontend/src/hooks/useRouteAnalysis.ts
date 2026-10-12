import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { ApiError } from '../services/apiClient'
import { createTrip, fetchTrip, getForecast, getTraffic, reanalyzeTrip } from '../services/trips'
import type { Forecast, Route, Trip } from '../types/api'

export const STRIP_OFFSETS = Array.from({ length: 16 }, (_, i) => (i + 1) * 3) // +3h .. +48h

const retryTransient = (count: number, e: unknown) => count < 1 && e instanceof ApiError && e.retryable

/** A saved trip, rebuilt from the database. Freshly created trips are seeded into this cache. */
export function useTrip(id: string | null) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => fetchTrip(id as string),
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
      qc.setQueryData(['trip', trip.trip_id], trip)
      onCreated(trip)
    },
  })
}

export function useReanalyze() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: reanalyzeTrip,
    onSuccess: (trip) => {
      qc.removeQueries({ queryKey: ['forecast', trip.trip_id] }) // route ids and weather changed
      qc.setQueryData(['trip', trip.trip_id], trip)
    },
  })
}

export function useForecast(id: string | null, offset: number) {
  return useQuery({
    queryKey: ['forecast', id, offset],
    queryFn: () => getForecast(id as string, offset),
    enabled: !!id && offset > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: retryTransient,
  })
}

/** The trip as it looks at the selected forecast offset (geometry from the trip, risk from the forecast). */
export function useTripView(trip: Trip | undefined, offset: number) {
  const forecast = useForecast(trip?.trip_id ?? null, offset)
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

/** Per-offset route summaries for the heat strip; filled in gradually by a sequential prefetch. */
export function useForecastStrip(tripId: string | null, version: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    ;(async () => {
      for (const offset of STRIP_OFFSETS) {
        if (cancelled) return
        try {
          await qc.prefetchQuery({
            queryKey: ['forecast', tripId, offset],
            queryFn: () => getForecast(tripId, offset),
            staleTime: 5 * 60 * 1000,
          })
        } catch {
          return
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [qc, tripId, version])

  const results = useQueries({
    queries: STRIP_OFFSETS.map((offset) => ({
      queryKey: ['forecast', tripId, offset],
      queryFn: () => getForecast(tripId as string, offset),
      enabled: false,
      staleTime: 5 * 60 * 1000,
    })),
  })
  return STRIP_OFFSETS.map((offset, i) => ({ offset, data: results[i].data as Forecast | undefined }))
}

/** Traffic-aware delay and congested sections for the departure offset on screen. Non-critical:
 *  failures just mean no traffic detail, never a broken page. */
export function useTripTraffic(tripId: string | null, offset: number, enabled: boolean) {
  return useQuery({
    queryKey: ['traffic', tripId, offset],
    queryFn: () => getTraffic(tripId as string, offset),
    enabled: !!tripId && enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
