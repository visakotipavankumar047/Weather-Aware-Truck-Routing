import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { TRAFFIC_TILE_URL } from '../../services/traffic'
import type { Route, Trip, TripTraffic } from '../../types/api'
import { duration } from '../../utils/formatters'
import { haversineMiles } from '../../utils/geometry'
import { RISK, summaryLevel } from '../../utils/risk'
import { RiskBadge } from '../weather/RiskBadge'
import { ActiveRouteLayer, ROUTE_BLUE } from './ActiveRouteLayer'
import { CheckpointLabels } from './CheckpointLabels'
import { CheckpointMarker } from './CheckpointMarker'

const LETTERS = ['A', 'B', 'C']
const FRACTIONS = [0.5, 0.38, 0.62, 0.27, 0.73, 0.18, 0.82]

const DEST_SVG =
  '<svg class="pt-dest" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 33C13 33 2 20.5 2 12.5a11 11 0 0 1 22 0C24 20.5 13 33 13 33Z" fill="#12161d" stroke="#fff" stroke-width="2"/><rect x="8.5" y="8" width="9" height="9" rx="1.5" fill="#fff"/></svg>'

const originIcon = L.divIcon({
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: '<div class="pt-origin"></div>',
})
const destIcon = L.divIcon({ className: '', iconSize: [26, 34], iconAnchor: [13, 33], html: DEST_SVG })

function tag(route: Route, text: string, on: boolean) {
  const r = RISK[summaryLevel(route.risk_summary)]
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="route-tag${on ? ' on' : ''}"><span class="sq" style="background:${r.color};color:${r.on}">${r.code}</span>${text}</div>`,
  })
}

function deltaLabel(minutes: number) {
  const m = Math.round(Math.abs(minutes))
  return m === 0 ? 'Same time' : `${minutes > 0 ? '+' : '−'}${m} min`
}

/** Choose a spot on each route for its label so labels never overlap: try several positions
 *  and take the first far enough from labels already placed (scaled to route length). */
function placeLabels(routes: Route[], selectedId: number | null): Map<number, [number, number]> {
  const placed: [number, number][] = []
  const out = new Map<number, [number, number]>()
  const minGap = Math.max(1, ...routes.map((r) => r.distance_miles)) * 0.14
  const order = [...routes].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.rank - b.rank))
  for (const r of order) {
    const g = r.geometry
    if (g.length < 2) continue
    let best: [number, number] | null = null
    let bestGap = -1
    for (const f of FRACTIONS) {
      const p = g[Math.floor((g.length - 1) * f)]
      const gap = placed.length ? Math.min(...placed.map((q) => haversineMiles(p, q))) : Infinity
      if (gap >= minGap) {
        best = p
        break
      }
      if (gap > bestGap) {
        best = p
        bestGap = gap
      }
    }
    if (best) {
      placed.push(best)
      out.set(r.id, best)
    }
  }
  return out
}

function FitBounds({ routes, tripKey }: { routes: Route[]; tripKey: string }) {
  const map = useMap()
  useEffect(() => {
    const pts = routes.flatMap((r) => r.geometry)
    if (pts.length < 2) return
    map.flyToBounds(L.latLngBounds(pts), { padding: [70, 70], duration: 0.8 })
    // refit only for a new analysis, not when the forecast offset changes risk values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tripKey])
  return null
}

function PanToCheckpoint({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.panTo(target, { animate: true, duration: 0.4 })
  }, [map, target])
  return null
}

interface Props {
  trip: Trip | null
  routes: Route[]
  selectedRouteId: number | null
  onSelectRoute: (id: number) => void
  selectedSeq: number | null
  onSelectCheckpoint: (seq: number) => void
  loading: boolean
  trafficAvailable: boolean
  trafficOn: boolean
  onToggleTraffic: () => void
  traffic: TripTraffic | undefined
}

const ctrl =
  'grid h-10 w-10 place-items-center bg-white text-ink hover:bg-panel text-lg leading-none disabled:cursor-not-allowed disabled:opacity-50'

export function RouteMap({
  trip,
  routes,
  selectedRouteId,
  onSelectRoute,
  selectedSeq,
  onSelectCheckpoint,
  loading,
  trafficAvailable,
  trafficOn,
  onToggleTraffic,
  traffic,
}: Props) {
  const [map, setMap] = useState<L.Map | null>(null)
  const selected = routes.find((r) => r.id === selectedRouteId) ?? null
  const tripKey = routes.map((r) => r.id).join('-')
  const ordered = [...routes].sort((a, b) => a.rank - b.rank)
  const labels = useMemo(() => placeLabels(routes, selectedRouteId), [routes, selectedRouteId])
  const target = useMemo<[number, number] | null>(() => {
    const c = selected?.checkpoints.find((x) => x.sequence === selectedSeq)
    return c ? [c.lat, c.lon] : null
  }, [selected, selectedSeq])
  const selectedTraffic = traffic?.routes.find((t) => t.route_id === selectedRouteId)

  const fit = () => {
    const pts = routes.flatMap((r) => r.geometry)
    if (map && pts.length > 1) map.flyToBounds(L.latLngBounds(pts), { padding: [70, 70] })
  }

  return (
    <div className="relative h-full min-h-[320px]">
      <MapContainer
        ref={setMap}
        center={[39.5, -98.35]}
        zoom={4}
        zoomControl={false}
        className="h-full w-full"
        aria-label="Map of route alternatives with weather risk checkpoints"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {trafficOn && trafficAvailable && (
          <Pane name="traffic-flow" style={{ zIndex: 350 }}>
            <TileLayer url={TRAFFIC_TILE_URL} opacity={0.9} maxZoom={19} attribution="Traffic © TomTom" />
          </Pane>
        )}
        <FitBounds routes={routes} tripKey={tripKey} />
        <PanToCheckpoint target={target} />

        {/* Fixed panes decide stacking: unselected routes always under the active one. */}
        <Pane name="alt-routes" style={{ zIndex: 405 }}>
          {ordered
            .filter((r) => r.id !== selectedRouteId)
            .map((r) => (
              <Polyline
                key={`${r.id}-casing`}
                positions={r.geometry}
                pathOptions={{ color: '#ffffff', weight: 10, opacity: 1, lineCap: 'round' }}
                interactive={false}
              />
            ))}
          {ordered
            .filter((r) => r.id !== selectedRouteId)
            .map((r) => (
              <Polyline
                key={`${r.id}-line`}
                positions={r.geometry}
                pathOptions={{ color: '#7b8798', weight: 6, opacity: 1, lineCap: 'round' }}
                eventHandlers={{ click: () => onSelectRoute(r.id) }}
              >
                <Tooltip sticky>Route {LETTERS[Math.min(r.rank - 1, 2)]}: click to select</Tooltip>
              </Polyline>
            ))}
        </Pane>

        {selected && (
          <ActiveRouteLayer
            key={selected.id}
            route={selected}
            traffic={trafficOn ? selectedTraffic : undefined}
          />
        )}

        {ordered.map((r) => {
          const p = labels.get(r.id)
          if (!p) return null
          const on = r.id === selectedRouteId
          const text = on || !selected ? duration(r.duration_minutes) : deltaLabel(r.duration_minutes - selected.duration_minutes)
          return (
            <Marker
              key={`${r.id}-tag-${on}`}
              position={p}
              icon={tag(r, text, on)}
              zIndexOffset={on ? 700 : 600}
              eventHandlers={{ click: () => onSelectRoute(r.id) }}
              keyboard={false}
            />
          )
        })}

        {selected?.checkpoints.map((c) => (
          <CheckpointMarker
            key={`${selected.id}-${c.sequence}`}
            checkpoint={c}
            selected={c.sequence === selectedSeq}
            onSelect={() => onSelectCheckpoint(c.sequence)}
          />
        ))}

        {selected && (
          <CheckpointLabels key={selected.id} route={selected} selectedSeq={selectedSeq} onSelect={onSelectCheckpoint} />
        )}

        {trip && (
          <>
            <Marker position={[trip.origin_lat, trip.origin_lon]} icon={originIcon} zIndexOffset={2000}>
              <Tooltip direction="top" offset={[0, -10]}>
                {trip.origin_label.split(', ')[0]}
              </Tooltip>
            </Marker>
            <Marker position={[trip.destination_lat, trip.destination_lon]} icon={destIcon} zIndexOffset={2000}>
              <Tooltip direction="top" offset={[0, -32]}>
                {trip.destination_label.split(', ')[0]}
              </Tooltip>
            </Marker>
          </>
        )}
      </MapContainer>

      {/* Map controls: one vocabulary, rectangular, hairline-divided. */}
      <div className="absolute top-3 right-3 z-[var(--z-map-ui)] flex flex-col gap-2">
        <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-ctl)] border border-line shadow-[0_1px_4px_rgb(18_22_29/0.25)]">
          <button type="button" className={ctrl} aria-label="Zoom in" onClick={() => map?.zoomIn()}>
            +
          </button>
          <button type="button" className={ctrl} aria-label="Zoom out" onClick={() => map?.zoomOut()}>
            −
          </button>
        </div>
        <button
          type="button"
          className={`${ctrl} rounded-[var(--radius-ctl)] border border-line shadow-[0_1px_4px_rgb(18_22_29/0.25)]`}
          aria-label="Fit all routes"
          onClick={fit}
          disabled={routes.length === 0}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        onClick={onToggleTraffic}
        disabled={!trafficAvailable}
        aria-pressed={trafficOn && trafficAvailable}
        title={trafficAvailable ? 'Show or hide live traffic' : 'Add TOMTOM_API_KEY to backend/.env to enable live traffic'}
        className={`absolute top-3 left-3 z-[var(--z-map-ui)] flex h-10 items-center gap-2 rounded-[var(--radius-ctl)] border px-3 text-[13px] font-semibold shadow-[0_1px_4px_rgb(18_22_29/0.25)] disabled:cursor-not-allowed disabled:opacity-60 ${
          trafficOn && trafficAvailable
            ? 'border-ink bg-ink text-white'
            : 'border-line bg-white text-ink hover:bg-panel'
        }`}
      >
        <span className="flex gap-0.5" aria-hidden="true">
          <i className="block h-3.5 w-1 rounded-[1px] bg-[#23863f]" />
          <i className="block h-3.5 w-1 rounded-[1px] bg-[#f29900]" />
          <i className="block h-3.5 w-1 rounded-[1px] bg-[#d93025]" />
        </span>
        Traffic {trafficAvailable ? (trafficOn ? 'on' : 'off') : 'unavailable'}
      </button>

      {loading && (
        <p className="absolute top-3 left-1/2 z-[var(--z-map-ui)] -translate-x-1/2 rounded-[var(--radius-ctl)] bg-ink px-3 py-2 text-xs font-medium text-white shadow-lg">
          Updating forecast…
        </p>
      )}

      {/* Legend: what the two channels on the route mean. */}
      {trip && (
        <div className="absolute bottom-6 left-3 z-[var(--z-map-ui)] hidden w-[236px] rounded-[var(--radius-box)] border border-line bg-white p-3 text-xs shadow-[0_1px_4px_rgb(18_22_29/0.25)] md:block">
          <p className="mb-1.5 font-semibold text-ink">Reading the route</p>
          <p className="flex items-center gap-2 text-ink-2">
            <span className="block h-1.5 w-8 rounded-full" style={{ background: ROUTE_BLUE }} />
            <span className="block h-1.5 w-3 rounded-full bg-[#f29900]" />
            <span className="block h-1.5 w-3 rounded-full bg-[#d93025]" />
            Line: traffic
          </p>
          <p className="mt-1.5 mb-1 text-ink-2">Glow around it: weather risk</p>
          <div className="flex flex-wrap gap-1">
            {(['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL', 'UNKNOWN'] as const).map((k) => (
              <RiskBadge key={k} level={k} size="sm" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
