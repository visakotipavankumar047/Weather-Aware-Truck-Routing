import { useState } from 'react'
import type { ApiError } from '../../services/apiClient'
import type { Place, Trip, TripRequest } from '../../types/api'
import { toLocalInput, tzName } from '../../utils/formatters'
import { ApiErrorState } from '../feedback/ApiErrorState'
import { Spinner, SwapIcon } from '../layout/icons'
import { PlaceSearch } from './PlaceSearch'

const SAMPLES: { name: string; a: Place; b: Place }[] = [
  {
    name: 'Denver to Boulder',
    a: { label: 'Denver, Colorado, United States', lat: 39.7392, lon: -104.9903 },
    b: { label: 'Boulder, Colorado, United States', lat: 40.015, lon: -105.2705 },
  },
  {
    name: 'Dallas to Houston',
    a: { label: 'Dallas, Texas, United States', lat: 32.7767, lon: -96.797 },
    b: { label: 'Houston, Texas, United States', lat: 29.7604, lon: -95.3698 },
  },
  {
    name: 'London to Manchester',
    a: { label: 'London, England, United Kingdom', lat: 51.5074, lon: -0.1278 },
    b: { label: 'Manchester, England, United Kingdom', lat: 53.4808, lon: -2.2426 },
  },
  {
    name: 'Sydney to Melbourne',
    a: { label: 'Sydney, New South Wales, Australia', lat: -33.8688, lon: 151.2093 },
    b: { label: 'Melbourne, Victoria, Australia', lat: -37.8136, lon: 144.9631 },
  },
  {
    name: 'Los Angeles to New York',
    a: { label: 'Los Angeles, California, United States', lat: 34.0522, lon: -118.2437 },
    b: { label: 'New York, New York, United States', lat: 40.7128, lon: -74.006 },
  },
]

const INTERVALS = [10, 25, 50] as const

interface Props {
  initial?: Trip
  pending: boolean
  error: ApiError | Error | null
  onSubmit: (req: TripRequest) => void
  onRetry: () => void
}

function defaultDeparture() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  return toLocalInput(d)
}

export function TripForm({ initial, pending, error, onSubmit, onRetry }: Props) {
  const [originText, setOriginText] = useState(initial?.origin_label ?? '')
  const [origin, setOrigin] = useState<Place | null>(
    initial ? { label: initial.origin_label, lat: initial.origin_lat, lon: initial.origin_lon } : null,
  )
  const [destText, setDestText] = useState(initial?.destination_label ?? '')
  const [dest, setDest] = useState<Place | null>(
    initial
      ? { label: initial.destination_label, lat: initial.destination_lat, lon: initial.destination_lon }
      : null,
  )
  const [departure, setDeparture] = useState(initial ? toLocalInput(new Date(initial.departure_at)) : defaultDeparture())
  const [load, setLoad] = useState(String(initial?.load_weight_lb ?? 32000))
  const [interval, setInterval] = useState<10 | 25 | 50>((initial?.checkpoint_interval_miles as 10 | 25 | 50) ?? 25)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const applySample = (s: (typeof SAMPLES)[number]) => {
    setOrigin(s.a)
    setOriginText(s.a.label)
    setDest(s.b)
    setDestText(s.b.label)
    setErrors({})
  }

  const swap = () => {
    setOrigin(dest)
    setDest(origin)
    setOriginText(destText)
    setDestText(originText)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    const err: Record<string, string> = {}
    if (!originText.trim()) err.origin = 'Enter a starting point.'
    else if (!origin) err.origin = 'Pick a place from the suggestions so the location is exact.'
    if (!destText.trim()) err.destination = 'Enter a destination.'
    else if (!dest) err.destination = 'Pick a place from the suggestions so the location is exact.'
    const lb = Number(load)
    if (!Number.isFinite(lb) || lb <= 0) err.load = 'Load weight must be greater than zero.'
    const when = new Date(departure)
    if (!departure || Number.isNaN(when.getTime())) err.departure = 'Choose a departure date and time.'
    setErrors(err)
    if (Object.keys(err).length || !origin || !dest) return
    onSubmit({
      origin,
      destination: dest,
      departure_at: when.toISOString(),
      load_weight_lb: lb,
      checkpoint_interval_miles: interval,
    })
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending}>
      {/* One bordered unit, like a map app's direction inputs. */}
      <div className="relative rounded-[var(--radius-box)] border border-line bg-white">
        <PlaceSearch
          label="Starting point"
          kind="origin"
          text={originText}
          onText={setOriginText}
          place={origin}
          onPlace={setOrigin}
          error={errors.origin}
          disabled={pending}
        />
        <div className="mx-3 border-t border-line-2" />
        <PlaceSearch
          label="Destination"
          kind="destination"
          text={destText}
          onText={setDestText}
          place={dest}
          onPlace={setDest}
          error={errors.destination}
          disabled={pending}
        />
        <button
          type="button"
          onClick={swap}
          disabled={pending}
          aria-label="Swap start and destination"
          className="absolute top-1/2 right-1.5 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[4px] border border-line bg-white text-ink-2 hover:bg-panel hover:text-ink"
        >
          <SwapIcon />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="departure" className="label">
            Leave ({tzName()})
          </label>
          <input
            id="departure"
            type="datetime-local"
            value={departure}
            disabled={pending}
            onChange={(e) => setDeparture(e.target.value)}
            aria-invalid={!!errors.departure}
            className="field num"
          />
          {errors.departure && <p className="mt-1 text-[13px] text-[#a31d14]">{errors.departure}</p>}
        </div>
        <div>
          <label htmlFor="load" className="label">
            Load (lb)
          </label>
          <input
            id="load"
            type="number"
            inputMode="numeric"
            min={1}
            step={500}
            value={load}
            disabled={pending}
            onChange={(e) => setLoad(e.target.value)}
            aria-invalid={!!errors.load}
            className="field num"
          />
          {errors.load && <p className="mt-1 text-[13px] text-[#a31d14]">{errors.load}</p>}
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="label">Weather check every</legend>
        <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-ctl)] border border-line">
          {INTERVALS.map((n) => (
            <label
              key={n}
              className={`num cursor-pointer border-r border-line py-2 text-center text-[13px] font-semibold last:border-r-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent ${
                interval === n ? 'bg-ink text-white' : 'bg-white text-ink-2 hover:bg-panel'
              }`}
            >
              <input
                type="radio"
                name="interval"
                className="sr-only"
                checked={interval === n}
                disabled={pending}
                onChange={() => setInterval(n)}
              />
              {n} mi
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" disabled={pending} className="btn btn-primary mt-4 w-full">
        {pending ? (
          <>
            <Spinner /> Checking routes and forecasts…
          </>
        ) : (
          'Check route'
        )}
      </button>

      {error && (
        <div className="mt-3">
          <ApiErrorState error={error} onRetry={onRetry} />
        </div>
      )}

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-semibold text-ink-3">Try an example</p>
        <ul className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <li key={s.name}>
              <button type="button" disabled={pending} onClick={() => applySample(s)} className="btn btn-sm">
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  )
}
