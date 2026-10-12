import { useEffect, useRef, useState } from 'react'
import { useDebounced } from '../../hooks/useGeocoding'
import { STRIP_OFFSETS, useForecastStrip } from '../../hooks/useRouteAnalysis'
import type { Route, Trip } from '../../types/api'
import { dateTime, num, timeOnly } from '../../utils/formatters'
import { RISK, summaryLevel } from '../../utils/risk'

interface Props {
  trip: Trip
  offset: number
  onOffset: (n: number) => void
  selectedRouteId: number | null
  baseRoute: Route | null // stored offset-0 analysis of the selected route
  loading: boolean
  stale: boolean
}

const TICKS = [0, 12, 24, 36, 48]
const CELL_W = 100 / (STRIP_OFFSETS.length + 1) // 17 cells tile the track exactly

export function DepartureDock({ trip, offset, onOffset, selectedRouteId, baseRoute, loading, stale }: Props) {
  const [local, setLocal] = useState(offset)
  const debounced = useDebounced(local, 250)
  const committed = useRef(offset)

  useEffect(() => {
    if (debounced !== committed.current) {
      committed.current = debounced
      onOffset(debounced)
    }
  }, [debounced, onOffset])

  useEffect(() => {
    if (offset !== committed.current) {
      committed.current = offset
      setLocal(offset)
    }
  }, [offset])

  const strip = useForecastStrip(trip)
  const cells = [
    { offset: 0, summary: baseRoute?.risk_summary ?? null },
    ...strip.map(({ offset: o, data }) => ({
      offset: o,
      summary: data?.routes.find((r) => r.id === selectedRouteId)?.risk_summary ?? null,
    })),
  ]
  const loaded = cells.filter((c) => c.summary).length

  const calm = cells
    .filter((c) => c.summary && !c.summary.has_no_travel && c.summary.average_risk !== null && c.summary.unknown_miles === 0)
    .sort((a, b) => a.summary!.average_risk! - b.summary!.average_risk! || a.offset - b.offset)[0]
  const current = cells.find((c) => c.offset === 0)?.summary?.average_risk

  const departMs = new Date(trip.departure_at).getTime()
  const at = (h: number) => new Date(departMs + h * 3600_000).toISOString()

  const jump = (n: number) => {
    committed.current = n
    setLocal(n)
    onOffset(n)
  }

  return (
    <section aria-label="Departure time" className="px-4 pt-3 pb-3 lg:px-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-xs font-semibold text-ink-3">Departure</h2>
          <p className="mt-0.5 flex items-baseline gap-2">
            <span className="num text-xl leading-none font-semibold">{timeOnly(at(local))}</span>
            <span className="text-[13px] text-ink-2">
              {dateTime(at(local)).split(',').slice(0, 2).join(',').replace(/ \d+:\d+.*$/, '')}
            </span>
            {local > 0 && <span className="num rounded-[4px] bg-panel px-1.5 py-0.5 text-xs font-semibold">+{local} h</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px]" aria-live="polite">
          <span className="text-ink-3">
            {loading || stale
              ? 'Loading forecast…'
              : loaded < STRIP_OFFSETS.length + 1
                ? `Scanning ${loaded}/${STRIP_OFFSETS.length + 1}`
                : 'Drag to compare departures'}
          </span>
          {calm && calm.offset !== offset && current != null && calm.summary!.average_risk! < current && (
            <button type="button" onClick={() => jump(calm.offset)} className="btn btn-sm btn-primary">
              Calmest: +{calm.offset} h
              <span className="num font-medium opacity-90">
                ({num(calm.summary!.average_risk!, 2)} vs {num(current, 2)})
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Risk strip and slider are one control: the strip is the track. */}
      <div className="relative mt-3 h-11">
        {cells.map((c) => {
          const lvl = c.summary ? summaryLevel(c.summary) : null
          const style = lvl ? RISK[lvl] : null
          return (
            <button
              key={c.offset}
              type="button"
              tabIndex={-1}
              aria-label={`Departure plus ${c.offset} hours: ${style ? style.label : 'loading'}`}
              title={`+${c.offset} h · ${style ? style.label : 'loading'}`}
              onClick={() => jump(c.offset)}
              className={`absolute top-0 h-11 border-r border-white text-[11px] font-bold ${style ? '' : 'skel !rounded-none'}`}
              style={{
                left: `${(c.offset / 48) * (100 - CELL_W)}%`,
                width: `${CELL_W}%`,
                background: style?.color,
                color: style?.on,
                opacity: c.offset === offset ? 1 : 0.82,
              }}
            >
              <span className="num">{style?.code}</span>
            </button>
          )
        })}
        <label htmlFor="offset" className="sr-only">
          Hours after planned departure, 0 to 48
        </label>
        <input
          id="offset"
          type="range"
          min={0}
          max={48}
          step={1}
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          aria-valuetext={`${local} hours after departure, ${dateTime(at(local))}`}
          className="scrub absolute inset-0 h-11 w-full"
        />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-ink-3" aria-hidden="true">
        {TICKS.map((h) => (
          <span
            key={h}
            className="num absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${(h / 48) * (100 - CELL_W) + CELL_W / 2}%` }}
          >
            {h === 0 ? 'Planned' : `${timeOnly(at(h))} · +${h} h`}
          </span>
        ))}
      </div>
    </section>
  )
}
