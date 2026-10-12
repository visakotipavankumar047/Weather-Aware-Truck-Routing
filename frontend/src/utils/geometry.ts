import type { Checkpoint } from '../types/api'

const R = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineMiles(a: [number, number], b: [number, number]) {
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface CorridorSegment {
  points: [number, number][]
  checkpoint: Checkpoint
}

/** Split a route polyline into pieces between consecutive checkpoints. Each piece carries the
 *  checkpoint it starts at, which is how the backend assigns risk miles (preceding checkpoint). */
export function corridorSegments(
  geometry: [number, number][],
  totalMiles: number,
  cps: Checkpoint[],
): CorridorSegment[] {
  if (geometry.length < 2 || cps.length < 2 || totalMiles <= 0) return []
  const cum = [0]
  for (let i = 1; i < geometry.length; i++) cum.push(cum[i - 1] + haversineMiles(geometry[i - 1], geometry[i]))
  const geoTotal = cum[cum.length - 1]
  const at = (c: Checkpoint) => Math.min(1, c.distance_miles / totalMiles) * geoTotal

  // Point at geometric distance g, plus the index of the first vertex at/after it.
  const pointAt = (g: number): [[number, number], number] => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < g) i++
    const seg = cum[i] - cum[i - 1]
    const f = seg ? Math.min(1, Math.max(0, (g - cum[i - 1]) / seg)) : 0
    const [a, b] = [geometry[i - 1], geometry[i]]
    return [[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i]
  }

  const out: CorridorSegment[] = []
  for (let k = 0; k < cps.length - 1; k++) {
    const [p0, i0] = pointAt(at(cps[k]))
    const [p1, i1] = pointAt(at(cps[k + 1]))
    const pts: [number, number][] = [p0]
    for (let i = i0; i < i1; i++) pts.push(geometry[i])
    pts.push(p1)
    out.push({ points: pts, checkpoint: cps[k] })
  }
  return out
}
