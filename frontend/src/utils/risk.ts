import type { RiskLevel, RiskSummary, Route } from '../types/api'

export interface RiskStyle {
  label: string
  /** Single letter shown inside markers so colour is never the only signal. */
  code: string
  /** Fill colour for lines, markers and bars. */
  color: string
  /** Text colour that is readable on top of `color`. */
  on: string
  /** Tinted background for badges and rows. */
  soft: string
  /** Text colour that is readable on top of `soft`. */
  ink: string
}

// Display-only mapping. Classification itself always comes from the backend.
export const RISK: Record<RiskLevel, RiskStyle> = {
  LOW: { label: 'Low', code: 'L', color: '#23863f', on: '#ffffff', soft: '#e4f4e9', ink: '#17622e' },
  MODERATE: { label: 'Moderate', code: 'M', color: '#f2b705', on: '#201700', soft: '#fdf3d3', ink: '#6b4c00' },
  HIGH: { label: 'High', code: 'H', color: '#e8710a', on: '#ffffff', soft: '#fde9d6', ink: '#8f4300' },
  SEVERE: { label: 'Severe', code: 'S', color: '#d93025', on: '#ffffff', soft: '#fbe3e1', ink: '#a31d14' },
  NO_TRAVEL: { label: 'No travel', code: 'X', color: '#6a1b9a', on: '#ffffff', soft: '#f1e3f7', ink: '#5b1685' },
  UNKNOWN: { label: 'No forecast', code: '?', color: '#6b7280', on: '#ffffff', soft: '#eceef1', ink: '#3f4652' },
}

export const RISK_ORDER: RiskLevel[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL', 'UNKNOWN']

/** Worst condition present in a route summary (heat-strip cells; unknown never reads as safe). */
export function summaryLevel(s: RiskSummary): RiskLevel {
  if (s.has_no_travel || s.no_travel_miles > 0) return 'NO_TRAVEL'
  if (s.severe_miles > 0) return 'SEVERE'
  if (s.high_miles > 0) return 'HIGH'
  if (s.unknown_miles > 0 || s.average_risk === null) return 'UNKNOWN'
  return s.average_risk > 0 ? 'MODERATE' : 'LOW'
}

/** Explain the recommendation using only numbers the backend returned. */
export function explainRecommendation(routes: Route[], recommendedId: number | null): string {
  if (recommendedId === null) {
    return 'No route is recommended: every alternative contains at least one no-travel checkpoint for this load and departure time.'
  }
  const best = routes.find((r) => r.id === recommendedId)
  if (!best) return ''
  const others = routes.filter((r) => r.id !== recommendedId)
  if (others.length === 0) {
    return 'Only one route was available from the routing provider, so there is nothing to compare it against.'
  }
  const o = others.reduce((a, b) => (a.rank <= b.rank ? a : b)) // closest runner-up
  if (o.risk_summary.has_no_travel && !best.risk_summary.has_no_travel) {
    return 'The next-best route contains a no-travel checkpoint; this one does not.'
  }
  const hi = (r: Route) => r.risk_summary.high_miles + r.risk_summary.unknown_miles
  const checks: [string, number, number, string][] = [
    ['severe miles', best.risk_summary.severe_miles, o.risk_summary.severe_miles, ' mi'],
    ['high-risk miles', hi(best), hi(o), ' mi'],
    ['average risk', best.risk_summary.average_risk ?? 0, o.risk_summary.average_risk ?? 0, ''],
    ['travel time', best.duration_minutes, o.duration_minutes, ' min'],
  ]
  for (const [name, a, b, unit] of checks) {
    if (Math.abs(a - b) > 1e-9) {
      const f = (n: number) => (unit === '' ? n.toFixed(2) : `${Math.round(n * 10) / 10}${unit}`)
      return `Decided on ${name}: ${f(a)} vs ${f(b)} on the next-best route. Earlier criteria were tied.`
    }
  }
  return 'All criteria are tied with the alternative; this route comes first in the backend ordering.'
}

const mi = (n: number) => `${Math.round(n * 10) / 10} mi`

/** One plain-language line about the weather on a route, built from backend numbers only. */
export function weatherHeadline(route: Route): { text: string; level: RiskLevel } {
  const s = route.risk_summary
  if (s.has_no_travel) {
    const where = s.no_travel_miles > 0 ? ` for ${mi(s.no_travel_miles)}` : ' at the destination'
    return { text: `Do-not-travel conditions${where}`, level: 'NO_TRAVEL' }
  }
  if (s.severe_miles > 0) return { text: `Severe weather for ${mi(s.severe_miles)}`, level: 'SEVERE' }
  if (s.high_miles > 0) return { text: `High-risk weather for ${mi(s.high_miles)}`, level: 'HIGH' }
  if (s.unknown_miles > 0) return { text: `No forecast for ${mi(s.unknown_miles)}`, level: 'UNKNOWN' }
  if (s.average_risk === null) return { text: 'No forecast available', level: 'UNKNOWN' }
  if (s.average_risk > 0) return { text: 'Some moderate weather along the way', level: 'MODERATE' }
  return { text: 'Clear conditions the whole way', level: 'LOW' }
}

const RANK: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, SEVERE: 3, NO_TRAVEL: 4, UNKNOWN: 2.5 }

/** The checkpoints most worth a driver's attention, worst first. */
export function highlights(route: Route, limit = 3) {
  return route.checkpoints
    .filter((c) => c.risk !== 'LOW')
    .sort((a, b) => RANK[b.risk] - RANK[a.risk] || a.sequence - b.sequence)
    .slice(0, limit)
}
