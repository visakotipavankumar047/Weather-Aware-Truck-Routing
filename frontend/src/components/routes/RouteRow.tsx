import type { ReactNode } from 'react'
import type { Route, RouteTraffic } from '../../types/api'
import { duration, miles, num, timeOnly } from '../../utils/formatters'
import { RISK, highlights, weatherHeadline } from '../../utils/risk'
import { RiskSquare } from '../weather/RiskBadge'
import { RiskStrip } from '../weather/RiskStrip'

const LETTERS = ['A', 'B', 'C']

interface Props {
  route: Route
  traffic?: RouteTraffic
  trafficOn: boolean
  recommended: boolean
  fastest: boolean
  selected: boolean
  onSelect: () => void
  onFocusCheckpoint: (seq: number) => void
  children?: ReactNode
}

function Tag({ children, tone }: { children: ReactNode; tone: 'good' | 'info' | 'bad' }) {
  const tones = {
    good: 'bg-[#e4f4e9] text-[#17622e]',
    info: 'bg-accent-soft text-accent-strong',
    bad: 'bg-[#f1e3f7] text-[#5b1685]',
  }
  return <span className={`rounded-[4px] px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

function TrafficLine({ traffic }: { traffic?: RouteTraffic }) {
  if (!traffic) return <span className="text-ink-3">Checking traffic…</span>
  if (!traffic.matched) return <span className="text-ink-3">No traffic data for this road</span>
  const d = traffic.delay_minutes ?? 0
  if (d < 1) return <span className="text-ink-2">No traffic delay</span>
  const hot = d >= 10
  return (
    <span className="font-semibold" style={{ color: hot ? '#a31d14' : '#8f4300' }}>
      <span className="num">+{Math.round(d)} min</span> in traffic
    </span>
  )
}

export function RouteRow({
  route,
  traffic,
  trafficOn,
  recommended,
  fastest,
  selected,
  onSelect,
  onFocusCheckpoint,
  children,
}: Props) {
  const s = route.risk_summary
  const idx = Math.min(route.rank - 1, 2)
  const last = route.checkpoints[route.checkpoints.length - 1]
  const head = weatherHeadline(route)
  const hl = highlights(route)

  return (
    <article className="border-b border-line">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Route ${LETTERS[idx]}, ${duration(route.duration_minutes)}, ${head.text}`}
        className={`grid w-full grid-cols-[32px_minmax(0,1fr)] gap-x-3 px-4 py-3.5 text-left transition-colors ${
          selected ? 'bg-accent-soft' : 'hover:bg-panel'
        }`}
      >
        <span
          className={`grid h-8 w-8 place-items-center rounded-[4px] text-[13px] font-bold ${
            selected ? 'bg-ink text-white' : 'border border-line bg-white text-ink'
          }`}
        >
          {LETTERS[idx]}
        </span>
        <span className="min-w-0">
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="num text-[22px] leading-8 font-semibold">{duration(route.duration_minutes)}</span>
              {route.label && <span className="truncate text-xs font-medium text-ink-3">{route.label}</span>}
            </span>
            <span className="flex flex-wrap justify-end gap-1 pt-1">
              {recommended && <Tag tone="good">Best weather</Tag>}
              {fastest && <Tag tone="info">Fastest</Tag>}
              {!route.eligible && <Tag tone="bad">No travel</Tag>}
            </span>
          </span>
          <span className="mt-0.5 block text-[13px] text-ink-2">
            <span className="num">{miles(route.distance_miles)}</span>
            {last && (
              <>
                {' · arrives '}
                <span className="num">{timeOnly(last.eta)}</span>
              </>
            )}
          </span>

          <span className="mt-3 block">
            <RiskStrip route={route} />
          </span>
          <span className="mt-2 flex items-center gap-2 text-[13px]">
            <RiskSquare level={head.level} />
            <span className="font-medium" style={{ color: RISK[head.level].ink }}>
              {head.text}
            </span>
          </span>
          {trafficOn && (
            <span className="mt-1.5 flex items-center gap-2 text-[13px]">
              <span className="grid h-[18px] w-[18px] place-items-center" aria-hidden="true">
                <span className="block h-3.5 w-1 rounded-[1px] bg-ink-3" />
              </span>
              <TrafficLine traffic={traffic} />
            </span>
          )}
        </span>
      </button>

      {selected && (
        <div className="border-t border-line bg-white px-4 pt-3 pb-4">
          <dl className="grid grid-cols-3 divide-x divide-line rounded-[var(--radius-box)] border border-line text-center">
            {[
              ['Severe', miles(s.severe_miles)],
              ['High risk', miles(s.high_miles)],
              ['Avg risk', s.average_risk === null ? 'n/a' : `${num(s.average_risk, 2)} / 4`],
            ].map(([k, v]) => (
              <div key={k} className="py-2">
                <dt className="text-xs font-medium text-ink-3">{k}</dt>
                <dd className="num text-[15px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {s.unknown_miles > 0 && (
            <p className="mt-3 rounded-[4px] bg-panel px-3 py-2 text-[13px] text-ink-2">
              <span className="num">{miles(s.unknown_miles)}</span> have no forecast. They are not treated as safe and
              count against this route.
            </p>
          )}

          {hl.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[13px] font-semibold">Watch for</h3>
              <ul className="space-y-1">
                {hl.map((c) => (
                  <li key={c.sequence}>
                    <button
                      type="button"
                      onClick={() => onFocusCheckpoint(c.sequence)}
                      className="flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-left text-[13px] hover:brightness-95"
                      style={{ background: RISK[c.risk].soft, color: RISK[c.risk].ink }}
                    >
                      <RiskSquare level={c.risk} />
                      <span className="font-semibold">{RISK[c.risk].label}</span>
                      <span className="num ml-auto text-ink-2">
                        mi {num(c.distance_miles, 0)} · {timeOnly(c.eta)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <h3 className="mb-1 text-[13px] font-semibold">Checkpoints</h3>
            {children}
          </div>
        </div>
      )}
    </article>
  )
}
