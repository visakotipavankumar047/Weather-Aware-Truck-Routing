import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from '../services/apiClient'
import { searchPlaces } from '../services/geocoding'

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Backend-proxied Nominatim search. Cached for an hour per query; the caller debounces. */
export function useGeocoding(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['geocode', q.toLowerCase()],
    queryFn: ({ signal }) => searchPlaces(q, signal),
    enabled: q.length >= 3,
    staleTime: 60 * 60 * 1000,
    retry: (n, e) => n < 1 && e instanceof ApiError && e.retryable,
  })
}
