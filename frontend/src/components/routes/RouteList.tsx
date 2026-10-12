import type { Route, TripTraffic } from '../../types/api'
import { explainRecommendation } from '../../utils/risk'
import { CheckpointTimeline } from '../checkpoints/CheckpointTimeline'
import { AlertIcon } from '../layout/icons'
import { RouteRow } from './RouteRow'

interface Props {
  routes: Route[]
  recommendedId: number | null
  selectedId: number | null
  onSelect: (id: number) => void
  selectedSeq: number | null
  onSelectCheckpoint: (seq: number) => void
  warnings: string[]
  traffic: TripTraffic | undefined
  trafficOn: boolean
}

export function RouteList({
  routes,
  recommendedId,
  selectedId,
  onSelect,
  selectedSeq,
  onSelectCheckpoint,
  warnings,
  traffic,
  trafficOn,
}: Props) {
  const ordered = [...routes].sort((a, b) => a.rank - b.rank)
  const fastestId = routes.reduce((a, b) => (b.duration_minutes < a.duration_minutes ? b : a), routes[0])?.id

  return (
    <section aria-label="Route options">
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold">
          {ordered.length === 1 ? '1 route' : `${ordered.length} routes`}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{explainRecommendation(routes, recommendedId)}</p>
        <details className="mt-1.5 text-[13px] text-ink-2">
          <summary className="cursor-pointer font-medium text-accent hover:underline">How routes are ranked</summary>
          <p className="mt-1">
            Fewest severe miles, then fewest high-risk miles, then lowest average risk, then shortest travel time.
            A route with a no-travel checkpoint is never recommended.
          </p>
        </details>
        {ordered.length < 3 && (
          <p className="mt-2 text-xs text-ink-3">
            The routing provider returned {ordered.length === 1 ? 'one route' : `${ordered.length} routes`} for this
            trip. Alternatives are never invented.
          </p>
        )}
      </div>

      <div className="border-t border-line">
        {ordered.map((r) => (
          <RouteRow
            key={r.id}
            route={r}
            traffic={traffic?.routes.find((t) => t.route_id === r.id)}
            trafficOn={trafficOn}
            recommended={r.id === recommendedId}
            fastest={ordered.length > 1 && r.id === fastestId}
            selected={r.id === selectedId}
            onSelect={() => onSelect(r.id)}
            onFocusCheckpoint={onSelectCheckpoint}
          >
            <CheckpointTimeline route={r} selectedSeq={selectedSeq} onSelect={onSelectCheckpoint} />
          </RouteRow>
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-2 p-4" aria-label="Warnings">
          {warnings.map((w) => (
            <li
              key={w}
              className="flex gap-2 rounded-[var(--radius-box)] border border-[#ecd28a] bg-[#fdf6dd] p-3 text-[13px] text-[#5c4300]"
            >
              <AlertIcon className="mt-0.5 shrink-0 text-[#9a6b00]" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
