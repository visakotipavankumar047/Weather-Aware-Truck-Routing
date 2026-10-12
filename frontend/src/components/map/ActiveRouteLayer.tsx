import { memo, useMemo } from 'react'
import { Polyline, Tooltip } from 'react-leaflet'
import type { Route, RouteTraffic } from '../../types/api'
import { corridorSegments } from '../../utils/geometry'
import { RISK } from '../../utils/risk'
import { PANE } from './paneNames'

export const ROUTE_BLUE = '#1b5fd6'

/** Google-Maps-style congestion colours by delay magnitude (TomTom: 1 minor .. 3 major, 4 closed). */
const TRAFFIC_COLOR: Record<number, string> = { 1: '#f29900', 2: '#d93025', 3: '#8e1b14', 4: '#4a0d09' }
const HALO_OPACITY = { LOW: 0.28, MODERATE: 0.55, HIGH: 0.7, SEVERE: 0.8, NO_TRAVEL: 0.9, UNKNOWN: 0.5 } as const

interface Props {
  route: Route
  traffic?: RouteTraffic
}

/** Two channels on one road:
 *  - the wide halo is the weather corridor (colour = risk at the checkpoint each piece starts at)
 *  - the line itself is the traffic view (blue = flowing, orange/red = congestion) */
export const ActiveRouteLayer = memo(function ActiveRouteLayer({ route, traffic }: Props) {
  const segments = useMemo(
    () => corridorSegments(route.geometry, route.distance_miles, route.checkpoints),
    [route.geometry, route.distance_miles, route.checkpoints],
  )
  const sections = traffic?.matched ? (traffic.sections ?? []) : []

  return (
    <>
        {segments.map((s) => {
          const r = RISK[s.checkpoint.risk]
          return (
            <Polyline
              key={s.checkpoint.sequence}
              positions={s.points}
              pathOptions={{
                pane: PANE.halo,
                color: r.color,
                weight: 20,
                opacity: HALO_OPACITY[s.checkpoint.risk],
                lineCap: 'butt',
                dashArray: s.checkpoint.risk === 'UNKNOWN' ? '2 7' : undefined,
              }}
            >
              <Tooltip sticky>
                Weather: {r.label} from mile {Math.round(s.checkpoint.distance_miles)}
              </Tooltip>
            </Polyline>
          )
        })}
        <Polyline
          positions={route.geometry}
          pathOptions={{ pane: PANE.casing, color: '#ffffff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
          interactive={false}
        />
        <Polyline
          positions={route.geometry}
          pathOptions={{ pane: PANE.core, color: ROUTE_BLUE, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
          interactive={false}
        />
        {sections.map((sec, i) => (
          <Polyline
            key={i}
            positions={sec.points}
            pathOptions={{
              pane: PANE.sections,
              color: TRAFFIC_COLOR[sec.magnitude] ?? TRAFFIC_COLOR[2],
              weight: 6,
              opacity: 1,
              lineCap: 'butt',
              dashArray: sec.magnitude >= 4 ? '1 6' : undefined,
            }}
          >
            <Tooltip sticky>
              {sec.magnitude >= 4 ? 'Road closed' : `Traffic: +${Math.max(1, Math.round(sec.delay_s / 60))} min`}
            </Tooltip>
          </Polyline>
        ))}
    </>
  )
})
