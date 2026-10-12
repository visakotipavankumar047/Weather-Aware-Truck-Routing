import type { RiskLevel } from '../../types/api'
import { RISK } from '../../utils/risk'

/** Letter square + label. The letter is the non-colour cue. */
export function RiskBadge({ level, size = 'md' }: { level: RiskLevel; size?: 'sm' | 'md' }) {
  const r = RISK[level]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] font-semibold whitespace-nowrap ${
        size === 'sm' ? 'py-0.5 pr-1.5 pl-0.5 text-xs' : 'py-0.5 pr-2 pl-0.5 text-[13px]'
      }`}
      style={{ background: r.soft, color: r.ink }}
    >
      <span
        className="num grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[11px] leading-none font-bold"
        style={{ background: r.color, color: r.on }}
        aria-hidden="true"
      >
        {r.code}
      </span>
      {r.label}
    </span>
  )
}

/** Compact square only, for dense rows and map labels. */
export function RiskSquare({ level, className = '' }: { level: RiskLevel; className?: string }) {
  const r = RISK[level]
  return (
    <span
      className={`num grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[3px] text-[11px] leading-none font-bold ${className}`}
      style={{ background: r.color, color: r.on }}
      aria-hidden="true"
    >
      {r.code}
    </span>
  )
}
