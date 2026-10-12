import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { ApiErrorState } from '../components/feedback/ApiErrorState'
import { ApiStatus } from '../components/layout/ApiStatus'
import { HistoryIcon, RefreshIcon, Spinner } from '../components/layout/icons'
import { RouteMap } from '../components/map/RouteMap'
import { RouteList } from '../components/routes/RouteList'
import { TripForm } from '../components/trip/TripForm'
import { DepartureDock } from '../components/weather/DepartureDock'
import { useCreateTrip, useReanalyze, useTrip, useTripTraffic, useTripView } from '../hooks/useRouteAnalysis'
import { ApiError } from '../services/apiClient'
import { useTrafficStatus } from '../services/traffic'
import type { Trip, TripRequest } from '../types/api'
import { dateTime } from '../utils/formatters'
import { removeTrip } from '../utils/tripStore'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

const ID_KEY = 'wa:trip-id'
const RECENT_KEY = 'wa:recent-trips'

interface RecentTrip {
  id: string
  title: string
  at: string
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage unavailable: only affects convenience persistence */
  }
}

const short = (label: string) => label.split(', ')[0]

function Workspace() {
  const [tripId, setTripId] = useState<string | null>(() => read<string | null>(ID_KEY, null))
  const [offset, setOffset] = useState(0)
  const [routeId, setRouteId] = useState<number | null>(null)
  const [seq, setSeq] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [trafficOn, setTrafficOn] = useState(true)
  const [recent, setRecent] = useState<RecentTrip[]>(() => read<RecentTrip[]>(RECENT_KEY, []))
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null)

  const forget = useCallback((id: string) => {
    removeTrip(id)
    setRecent((r) => {
      const next = r.filter((t) => t.id !== id)
      write(RECENT_KEY, next)
      return next
    })
  }, [])

  const open = useCallback((id: string | null) => {
    setTripId(id)
    write(ID_KEY, id)
    setOffset(0)
    setRouteId(null)
    setSeq(null)
    setEditing(false)
  }, [])

  const create = useCreateTrip((t: Trip) => {
    open(t.trip_id)
    setRecent((r) => {
      const entry = { id: t.trip_id, title: `${short(t.origin_label)} to ${short(t.destination_label)}`, at: t.created_at }
      const next = [entry, ...r.filter((x) => x.id !== t.trip_id)].slice(0, 6)
      write(RECENT_KEY, next)
      return next
    })
  })
  const reanalyze = useReanalyze((oldId, t) => {
    // the refreshed analysis replaces the old one in the saved list and becomes the open trip
    removeTrip(oldId)
    setRecent((r) => {
      const entry = { id: t.trip_id, title: `${short(t.origin_label)} to ${short(t.destination_label)}`, at: t.created_at }
      const next = [entry, ...r.filter((x) => x.id !== oldId && x.id !== t.trip_id)].slice(0, 6)
      write(RECENT_KEY, next)
      return next
    })
    open(t.trip_id)
  })
  const tripQuery = useTrip(tripId)
  const trip = tripQuery.data
  const view = useTripView(trip, offset)
  const trafficStatus = useTrafficStatus()
  const trafficAvailable = !!trafficStatus.data?.enabled
  const traffic = useTripTraffic(trip, offset, trafficAvailable && trafficOn)

  const routes = view.routes
  const selectedId = routes.some((r) => r.id === routeId)
    ? routeId
    : (view.recommendedRouteId ?? [...routes].sort((a, b) => a.rank - b.rank)[0]?.id ?? null)
  const baseRoute = trip?.routes.find((r) => r.id === selectedId) ?? null

  const submit = (req: TripRequest) => {
    setLastRequest(req)
    reanalyze.reset()
    create.mutate(req)
  }
  const selectRoute = (id: number) => {
    setRouteId(id)
    setSeq(null)
  }

  const busy = create.isPending
  const showForm = !trip || editing || busy
  const notFound = tripQuery.error instanceof ApiError && tripQuery.error.status === 404

  return (
    <div className="grid h-dvh grid-cols-[400px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] max-lg:flex max-lg:h-auto max-lg:min-h-dvh max-lg:flex-col">
      <aside
        aria-label="Trip planning"
        className="row-span-2 flex min-h-0 flex-col border-r border-line bg-white max-lg:order-3 max-lg:border-t max-lg:border-r-0"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h1 className="text-[15px] leading-none font-semibold">
            Weather-Aware <span className="ml-1 font-normal text-ink-3">Truck routing</span>
          </h1>
          <ApiStatus />
        </header>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="p-4">
            {showForm ? (
              <TripForm
                key={trip?.trip_id ?? 'new'}
                initial={trip}
                pending={busy}
                error={create.error}
                onSubmit={submit}
                onRetry={() => lastRequest && create.mutate(lastRequest)}
              />
            ) : (
              trip && (
                <section aria-label="Current trip">
                  <div className="rounded-[var(--radius-box)] border border-line">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <span className="block h-3 w-3 shrink-0 rounded-full border-[3px] border-ink bg-white" aria-hidden="true" />
                      <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{short(trip.origin_label)}</p>
                      <button type="button" onClick={() => setEditing(true)} className="btn btn-sm">
                        Edit
                      </button>
                    </div>
                    <div className="mx-3 border-t border-line-2" />
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <span className="block h-3 w-3 shrink-0 bg-[#c5221f]" aria-hidden="true" />
                      <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{short(trip.destination_label)}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-ink-2">
                    <span>
                      Leaves <span className="num">{dateTime(trip.departure_at)}</span> ·{' '}
                      <span className="num">{trip.load_weight_lb.toLocaleString()} lb</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => reanalyze.mutate(trip)}
                      disabled={reanalyze.isPending}
                      className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline disabled:opacity-60"
                      title="Re-fetch routes and the latest forecast, and save the new analysis"
                    >
                      {reanalyze.isPending ? <Spinner /> : <RefreshIcon />} Refresh forecast
                    </button>
                  </div>
                </section>
              )
            )}
          </div>

          {reanalyze.error && trip && (
            <div className="px-4 pb-4">
              <ApiErrorState error={reanalyze.error} onRetry={() => reanalyze.mutate(trip)} compact />
            </div>
          )}

          {busy && (
            <div className="space-y-px border-t border-line" aria-live="polite">
              <p className="px-4 pt-3 pb-1 text-[13px] text-ink-2">Finding routes and reading the forecast at each checkpoint…</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skel m-4 !mt-3 h-24" />
              ))}
            </div>
          )}

          {!busy && tripId && tripQuery.isPending && <div className="skel m-4 h-24" aria-label="Loading saved trip" />}

          {!busy && tripQuery.isError && (
            <div className="space-y-2 px-4 pb-4">
              <ApiErrorState error={tripQuery.error} onRetry={() => tripQuery.refetch()} />
              {notFound && tripId && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    forget(tripId)
                    open(null)
                  }}
                >
                  Remove this saved trip
                </button>
              )}
            </div>
          )}

          {!busy && trip && (
            <RouteList
              routes={routes}
              recommendedId={view.recommendedRouteId}
              selectedId={selectedId}
              onSelect={selectRoute}
              selectedSeq={seq}
              onSelectCheckpoint={setSeq}
              warnings={trip.warnings}
              traffic={traffic.data}
              trafficOn={trafficAvailable && trafficOn}
            />
          )}

          {!trip && !busy && !tripId && (
            <p className="border-t border-line px-4 py-4 text-[13px] leading-relaxed text-ink-2">
              Pick a start and a destination anywhere. You get each route with the forecast for the hour your truck
              reaches every checkpoint, plus live traffic, and you can slide the departure time to see how the
              weather changes.
            </p>
          )}

          {recent.length > 0 && (
            <section aria-label="Saved trips" className="border-t border-line">
              <h2 className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-semibold text-ink-3">
                <HistoryIcon /> Saved trips
              </h2>
              <ul className="pb-2">
                {recent.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => open(t.id)}
                      aria-current={t.id === tripId}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[13px] hover:bg-panel ${
                        t.id === tripId ? 'bg-accent-soft font-semibold' : ''
                      }`}
                    >
                      <span className="truncate">{t.title}</span>
                      <span className="num shrink-0 text-xs text-ink-3">{dateTime(t.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="border-t border-line p-4 text-xs leading-relaxed text-ink-3">
            Decision support, not a guarantee of road safety. Routes use a general heavy-vehicle profile: weight,
            axle, bridge-clearance and hazmat limits are not enforced. Forecasts are uncertain; missing data shows as
            “No forecast”, never as safe.
          </p>
        </div>
      </aside>

      <main className="relative min-h-0 max-lg:order-1 max-lg:h-[46dvh]">
        <RouteMap
          trip={trip ?? null}
          routes={routes}
          selectedRouteId={selectedId}
          onSelectRoute={selectRoute}
          selectedSeq={seq}
          onSelectCheckpoint={setSeq}
          loading={view.loading}
          trafficAvailable={trafficAvailable}
          trafficOn={trafficOn}
          onToggleTraffic={() => setTrafficOn((v) => !v)}
          traffic={traffic.data}
        />
      </main>

      {trip && !busy ? (
        <div className="z-[var(--z-dock)] border-t border-line bg-white max-lg:order-2">
          {!!view.error && (
            <div className="px-4 pt-3">
              <ApiErrorState error={view.error} onRetry={() => view.refetch()} compact />
            </div>
          )}
          <DepartureDock
            trip={trip}
            offset={offset}
            onOffset={setOffset}
            selectedRouteId={selectedId}
            baseRoute={baseRoute}
            loading={view.loading}
            stale={view.stale}
          />
        </div>
      ) : (
        <div className="max-lg:hidden" />
      )}
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  )
}
