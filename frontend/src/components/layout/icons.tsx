import type { ReactNode, SVGProps } from 'react'

function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  )
}

type P = SVGProps<SVGSVGElement>
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
)
export const SwapIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
  </Svg>
)
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const TruckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2 6h11v10H2zM13 9h4.5L21 12.5V16h-8" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
)
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)
export const WindIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 9h10a2.5 2.5 0 1 0-2.5-2.5M3 15h14a2.5 2.5 0 1 1-2.5 2.5M3 12h7" />
  </Svg>
)
export const RainIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 15a4.5 4.5 0 0 1 .6-8.9A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 0 7M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
  </Svg>
)
export const SnowIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
  </Svg>
)
export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.2v.1" />
  </Svg>
)
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.5-4M4 5v3h3M4 13a8 8 0 0 0 14.5 4M20 19v-3h-3" />
  </Svg>
)
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)
export const HistoryIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8M12 8v4.5l3 1.5" />
  </Svg>
)
export const Spinner = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} width="1em" height="1em" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
)
