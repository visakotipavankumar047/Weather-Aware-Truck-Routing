import L from 'leaflet'
import { useState } from 'react'
import { Marker, useMap, useMapEvents } from 'react-leaflet'
import type { Checkpoint, Route } from '../../types/api'
import { num, timeOnly } from '../../utils/formatters'
import { RISK } from '../../utils/risk'

const W = 124 // label box used for collision tests, px
const H = 38
const GAP = 16 // distance from the marker square to the label
const WORSE: Record<Checkpoint['risk'], number> = {
  LOW: 0,
  MODERATE: 1,
  UNKNOWN: 2,
  HIGH: 3,
  SEVERE: 4,
  NO_TRAVEL: 5,
}

function labelHtml(c: Checkpoint) {
  const r = RISK[c.risk]
  const time = timeOnly(c.eta)
  let top: string
  let sub: string
  if (!c.weather) {
    top = 'No forecast'
    sub = time
  } else {
    const { wind_mph: wind, rain_in_hr: rain, snow_in_hr: snow } = c.weather
    top = `${Math.round(wind)} mph wind`
    const wet = [rain > 0.004 ? `rain ${num(rain, 2)}` : '', snow > 0.004 ? `snow ${num(snow, 1)}` : '']
      .filter(Boolean)
      .join(' · ')
    sub = `${time} · ${wet ? `${wet} in/hr` : 'dry'}`
  }
  const tint = c.risk === 'LOW' ? '' : `background:${r.soft};border-color:${r.color};color:${r.ink};`
  return `<div class="wx" style="${tint}"><b>${top}</b><i>${sub}</i></div>`
}

interface Props {
  route: Route
  selectedSeq: number | null
  onSelect: (seq: number) => void
}

/** Weather written on the map next to each checkpoint. Labels are placed greedily by importance
 *  (selected, then worst risk, then start/end) and skipped when they would cover another label or
 *  checkpoint, so zooming in reveals more of them. */
export function CheckpointLabels({ route, selectedSeq, onSelect }: Props) {
  const map = useMap()
  const [, bump] = useState(0)
  useMapEvents({ zoomend: () => bump((n) => n + 1), moveend: () => bump((n) => n + 1) })

  const size = map.getSize()
  const pts = route.checkpoints.map((c) => ({ c, p: map.latLngToContainerPoint([c.lat, c.lon]) }))
  const onScreen = (p: L.Point) => p.x > -W && p.y > -H && p.x < size.x + W && p.y < size.y + H

  const last = route.checkpoints.length - 1
  const order = [...pts]
    .filter(({ p }) => onScreen(p))
    .sort((a, b) => {
      const pa = a.c.sequence === selectedSeq ? 100 : WORSE[a.c.risk] * 10 + (a.c.sequence === 0 || a.c.sequence === last ? 5 : 0)
      const pb = b.c.sequence === selectedSeq ? 100 : WORSE[b.c.risk] * 10 + (b.c.sequence === 0 || b.c.sequence === last ? 5 : 0)
      return pb - pa || a.c.sequence - b.c.sequence
    })

  type Box = [number, number, number, number]
  const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
  // every checkpoint square is an obstacle for other labels
  const squares: Box[] = pts.map(({ p }) => [p.x - 12, p.y - 12, p.x + 12, p.y + 12])
  const placed: Box[] = []
  const shown: Checkpoint[] = []
  for (const { c, p } of order) {
    const box: Box = [p.x + GAP, p.y - H / 2, p.x + GAP + W, p.y + H / 2]
    const ownSquare = squares[c.sequence]
    const blockedBySquare = squares.some((s) => s !== ownSquare && hit(box, s))
    if (blockedBySquare || placed.some((b) => hit(box, b))) continue
    placed.push(box)
    shown.push(c)
  }

  return (
    <>
      {shown.map((c) => (
        <Marker
          key={`${route.id}-wx-${c.sequence}-${c.risk}-${c.eta}`}
          position={[c.lat, c.lon]}
          icon={L.divIcon({ className: '', iconSize: [0, 0], html: labelHtml(c) })}
          zIndexOffset={c.sequence === selectedSeq ? 900 : 200}
          eventHandlers={{ click: () => onSelect(c.sequence) }}
          keyboard={false}
        />
      ))}
    </>
  )
}
