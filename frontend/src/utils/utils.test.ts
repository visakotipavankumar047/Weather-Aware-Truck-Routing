import { describe, expect, it } from 'vitest'
import type { Checkpoint, Route, RiskSummary } from '../types/api'
import { corridorSegments } from './geometry'
import { explainRecommendation, summaryLevel } from './risk'

const summary = (o: Partial<RiskSummary> = {}): RiskSummary => ({
  severe_miles: 0,
  high_miles: 0,
  no_travel_miles: 0,
  unknown_miles: 0,
  average_risk: 0,
  has_no_travel: false,
  ...o,
})

const cp = (sequence: number, distance_miles: number, lon: number): Checkpoint => ({
  sequence,
  distance_miles,
  lat: 40,
  lon,
  eta: '2026-10-20T08:00:00Z',
  weather: null,
  risk: 'LOW',
  reasons: [],
})

const route = (id: number, rank: number, s: Partial<RiskSummary>, minutes = 60): Route => ({
  id,
  label: '',
  rank,
  eligible: !s.has_no_travel,
  distance_miles: 50,
  duration_minutes: minutes,
  risk_summary: summary(s),
  geometry: [],
  checkpoints: [],
})

describe('summaryLevel', () => {
  it('never reports unknown weather as low', () => {
    expect(summaryLevel(summary({ unknown_miles: 5 }))).toBe('UNKNOWN')
    expect(summaryLevel(summary({ average_risk: null }))).toBe('UNKNOWN')
  })
  it('reports the worst condition present', () => {
    expect(summaryLevel(summary({ high_miles: 2 }))).toBe('HIGH')
    expect(summaryLevel(summary({ severe_miles: 1, high_miles: 9 }))).toBe('SEVERE')
    expect(summaryLevel(summary({ has_no_travel: true }))).toBe('NO_TRAVEL')
    expect(summaryLevel(summary())).toBe('LOW')
  })
})

describe('explainRecommendation', () => {
  it('says so when nothing is recommended', () => {
    expect(explainRecommendation([route(1, 1, { has_no_travel: true })], null)).toMatch(/No route is recommended/)
  })
  it('names the first criterion that differs', () => {
    const text = explainRecommendation(
      [route(1, 1, { severe_miles: 0, high_miles: 5 }), route(2, 2, { severe_miles: 0, high_miles: 12 })],
      1,
    )
    expect(text).toMatch(/high-risk miles: 5 mi vs 12 mi/)
  })
})

describe('corridorSegments', () => {
  const geometry: [number, number][] = [
    [40, -105],
    [40, -104],
    [40, -103],
  ]
  it('splits a route between checkpoints and keeps the preceding checkpoint', () => {
    const segs = corridorSegments(geometry, 100, [cp(0, 0, -105), cp(1, 50, -104), cp(2, 100, -103)])
    expect(segs).toHaveLength(2)
    expect(segs[0].checkpoint.sequence).toBe(0)
    expect(segs[0].points[0]).toEqual([40, -105])
    expect(segs[1].points[segs[1].points.length - 1][1]).toBeCloseTo(-103, 5)
    // continuous: the end of one piece is the start of the next
    const end = segs[0].points[segs[0].points.length - 1]
    expect(end[1]).toBeCloseTo(segs[1].points[0][1], 6)
  })
  it('returns nothing for degenerate input', () => {
    expect(corridorSegments([], 10, [])).toEqual([])
  })
})
