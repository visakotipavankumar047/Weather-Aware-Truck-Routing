import { useQuery } from '@tanstack/react-query'
import { API_BASE, api } from './apiClient'

export interface TrafficStatus {
  enabled: boolean
  provider: string
  attribution: string
}

/** Leaflet tile URL template. Tiles are proxied by Django so the provider key stays server-side. */
export const TRAFFIC_TILE_URL = `${API_BASE}/traffic/tiles/{z}/{x}/{y}.png`

export function useTrafficStatus() {
  return useQuery({
    queryKey: ['traffic-status'],
    queryFn: () => api<TrafficStatus>('/traffic/status/', { timeoutMs: 5000 }),
    staleTime: 30 * 1000,
    // while traffic is off keep checking, so enabling the key + backend restart is picked up without a reload
    refetchInterval: (q) => (q.state.data?.enabled ? false : 15000),
    retry: false,
  })
}
