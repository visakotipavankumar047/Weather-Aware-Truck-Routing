// Mirrors the Django serializers (backend/trips/serializers.py). The backend is the source of truth.
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'NO_TRAVEL' | 'UNKNOWN'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface Weather {
  forecast_time: string
  wind_mph: number
  rain_in_hr: number
  snow_in_hr: number
}

export interface Checkpoint {
  sequence: number
  distance_miles: number
  lat: number
  lon: number
  eta: string
  weather: Weather | null
  risk: RiskLevel
  reasons: string[]
}

export interface RiskSummary {
  severe_miles: number
  high_miles: number
  no_travel_miles: number
  unknown_miles: number
  average_risk: number | null
  has_no_travel: boolean
}

export interface RouteSummary {
  id: number
  label: string // how an alternative was found: "", "Shortest", "Avoids highways", "Alternative 1"
  rank: number
  eligible: boolean
  distance_miles: number
  duration_minutes: number
  risk_summary: RiskSummary
}

export interface Route extends RouteSummary {
  geometry: [number, number][]
  checkpoints: Checkpoint[]
}

export interface Trip {
  trip_id: string
  origin_label: string
  origin_lat: number
  origin_lon: number
  destination_label: string
  destination_lat: number
  destination_lon: number
  departure_at: string
  load_weight_lb: number
  checkpoint_interval_miles: number
  recommended_route_id: number | null
  warnings: string[]
  created_at: string
  routes: Route[]
}

export interface ForecastRoute extends RouteSummary {
  checkpoints: Checkpoint[]
}

export interface Forecast {
  trip_id: string
  offset_hours: number
  recommended_route_id: number | null
  routes: ForecastRoute[]
}

export interface TripRequest {
  origin: Place
  destination: Place
  departure_at: string
  load_weight_lb: number
  checkpoint_interval_miles: 10 | 25 | 50
}

export interface TrafficSection {
  magnitude: number // 0 none .. 3 major, 4 closed
  delay_s: number
  category: string
  points: [number, number][]
}

export interface RouteTraffic {
  route_id: number
  matched: boolean
  travel_minutes?: number
  typical_minutes?: number
  delay_minutes?: number
  sections?: TrafficSection[]
}

export interface TripTraffic {
  trip_id: string
  enabled: boolean
  offset_hours: number
  routes: RouteTraffic[]
}
