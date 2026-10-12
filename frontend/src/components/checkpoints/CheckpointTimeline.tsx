import type { Route } from '../../types/api'
import { num, timeOnly } from '../../utils/formatters'
import { RISK } from '../../utils/risk'
import { RiskSquare } from '../weather/RiskBadge'

interface Props {
  route: Route
  selectedSeq: number | null
  onSelect: (seq: number) => void
}

/** One row per checkpoint: ETA, risk and the forecast values. The rail between rows takes the
 *  colour of the risk the following stretch is counted under. */
export function CheckpointTimeline({ route, selectedSeq, onSelect }: Props) {
  const last = route.checkpoints.length - 1
  return (
    <ol aria-label="Checkpoints on this route">
      {route.checkpoints.map((c, i) => {
        const on = c.sequence === selectedSeq
        const title = i === 0 ? 'Start' : i === last ? 'Destination' : `Mile ${num(c.distance_miles, 0)}`
        return (
          <li key={c.sequence}>
            <button
              type="button"
              onClick={() => onSelect(c.sequence)}
              aria-current={on}
              className={`grid w-full grid-cols-[3.4rem_18px_minmax(0,1fr)] gap-x-2.5 rounded-[4px] px-1 text-left transition-colors hover:bg-panel ${
                on ? 'bg-accent-soft' : ''
              }`}
            >
              <span className="num pt-2 text-right text-xs font-semibold text-ink-2">{timeOnly(c.eta)}</span>
              <span className="relative flex justify-center pt-1.5">
                {i < last && (
                  <span
                    className="absolute top-6 -bottom-1.5 w-[3px]"
                    style={{ background: RISK[c.risk].color, opacity: c.risk === 'LOW' ? 0.4 : 1 }}
                    aria-hidden="true"
                  />
                )}
                <RiskSquare level={c.risk} className="relative" />
              </span>
              <span className="min-w-0 pt-1.5 pb-3">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold">{title}</span>
                  <span className="text-xs font-medium" style={{ color: RISK[c.risk].ink }}>
                    {RISK[c.risk].label}
                  </span>
                </span>
                {c.weather ? (
                  <span className="num mt-0.5 block text-xs text-ink-2">
                    {num(c.weather.wind_mph)} mph wind · {num(c.weather.rain_in_hr, 2)} in/hr rain ·{' '}
                    {num(c.weather.snow_in_hr, 2)} in/hr snow
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-ink-3">No forecast for this time</span>
                )}
                {c.risk !== 'LOW' && c.reasons.length > 0 && (
                  <span className="mt-0.5 block text-xs text-ink-3">{c.reasons.join(' · ')}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
