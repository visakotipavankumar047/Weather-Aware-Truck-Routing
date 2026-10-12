import L from 'leaflet'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Marker, Popup } from 'react-leaflet'
import type { Checkpoint } from '../../types/api'
import { dateTime, miles, num } from '../../utils/formatters'
import { RISK } from '../../utils/risk'
import { RiskBadge } from '../weather/RiskBadge'

function icon(risk: Checkpoint['risk'], selected: boolean) {
  const r = RISK[risk]
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
    html: `<div class="cp${selected ? ' sel' : ''}${risk === 'UNKNOWN' ? ' unk' : ''}" style="--c:${r.color};--on:${r.on}">${r.code}</div>`,
  })
}

interface Props {
  checkpoint: Checkpoint
  selected: boolean
  onSelect: () => void
}

export const CheckpointMarker = memo(function CheckpointMarker({ checkpoint: c, selected, onSelect }: Props) {
  const ref = useRef<L.Marker>(null)
  const ic = useMemo(() => icon(c.risk, selected), [c.risk, selected])

  useEffect(() => {
    if (selected) ref.current?.openPopup()
  }, [selected])

  return (
    <Marker
      ref={ref}
      position={[c.lat, c.lon]}
      icon={ic}
      zIndexOffset={selected ? 1000 : 0}
      eventHandlers={{ click: onSelect }}
      keyboard
      title={`Checkpoint ${c.sequence + 1}: ${RISK[c.risk].label}`}
    >
      <Popup minWidth={248} autoPan={false} closeButton={false}>
        <div className="text-[13px] text-ink">
          <div className="flex items-center justify-between gap-3 border-b border-line-2 px-3 py-2.5">
            <p className="font-semibold">
              Checkpoint {c.sequence + 1}
              <span className="num ml-2 font-medium text-ink-3">mile {num(c.distance_miles, 0)}</span>
            </p>
            <RiskBadge level={c.risk} size="sm" />
          </div>
          <div className="px-3 py-2.5">
            <p className="text-ink-2">
              ETA <span className="num font-semibold text-ink">{dateTime(c.eta)}</span>
            </p>
            {c.weather ? (
              <dl className="mt-2.5 grid grid-cols-3 divide-x divide-line-2 rounded-[4px] border border-line-2 text-center">
                {[
                  ['Wind', `${num(c.weather.wind_mph)}`, 'mph'],
                  ['Rain', `${num(c.weather.rain_in_hr, 2)}`, 'in/hr'],
                  ['Snow', `${num(c.weather.snow_in_hr, 2)}`, 'in/hr'],
                ].map(([k, v, u]) => (
                  <div key={k} className="py-1.5">
                    <dt className="text-[11px] font-medium text-ink-3">{k}</dt>
                    <dd className="num text-[15px] leading-tight font-semibold">{v}</dd>
                    <dd className="text-[10px] text-ink-3">{u}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2.5 rounded-[4px] bg-panel p-2 text-ink-2">
                No forecast for this time. Treated as unknown, not safe.
              </p>
            )}
            {c.risk !== 'LOW' && c.reasons.length > 0 && (
              <ul className="mt-2.5 space-y-0.5 text-ink-2">
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="num mt-2 text-[11px] text-ink-3">{miles(c.distance_miles)} from start</p>
          </div>
        </div>
      </Popup>
    </Marker>
  )
})
