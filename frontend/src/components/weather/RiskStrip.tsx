import type { Route } from '../../types/api'
import { RISK } from '../../utils/risk'

/** The trip drawn left to right. Each piece is coloured by the checkpoint it starts at (the same
 *  rule the backend uses for risk miles), so you can see where along the trip the weather turns. */
export function RiskStrip({ route }: { route: Route }) {
  const cps = route.checkpoints
  const total = route.distance_miles || 1
  if (cps.length < 2) return null
  const segs = cps.slice(0, -1).map((c, i) => ({
    key: c.sequence,
    w: ((cps[i + 1].distance_miles - c.distance_miles) / total) * 100,
    risk: c.risk,
  }))
  const above = segs.filter((s) => s.risk !== 'LOW').length
  return (
    <div
      className="flex h-2 gap-px overflow-hidden rounded-[2px] bg-white"
      role="img"
      aria-label={
        above
          ? `Weather along the route: ${above} of ${segs.length} segments above low risk`
          : 'Weather along the route: low risk throughout'
      }
    >
      {segs.map((s) => (
        <span
          key={s.key}
          style={{
            width: `${s.w}%`,
            background:
              s.risk === 'UNKNOWN'
                ? 'repeating-linear-gradient(45deg,#5b6573 0 3px,#a2abb8 3px 6px)'
                : RISK[s.risk].color,
          }}
        />
      ))}
    </div>
  )
}
