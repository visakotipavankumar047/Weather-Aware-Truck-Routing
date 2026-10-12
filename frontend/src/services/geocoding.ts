import type { Place } from '../types/api'
import { api } from './apiClient'

export const searchPlaces = (q: string, signal?: AbortSignal) =>
  api<Place[]>(`/geocoding/search/?q=${encodeURIComponent(q)}`, { signal })
