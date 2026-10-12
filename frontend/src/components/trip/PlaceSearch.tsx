import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useDebounced, useGeocoding } from '../../hooks/useGeocoding'
import type { Place } from '../../types/api'
import { loadRecent, rememberPlace } from '../../utils/recentPlaces'
import { ApiErrorState } from '../feedback/ApiErrorState'
import { CloseIcon, HistoryIcon, PinIcon } from '../layout/icons'

interface Props {
  label: string
  kind: 'origin' | 'destination'
  text: string
  onText: (t: string) => void
  place: Place | null
  onPlace: (p: Place | null) => void
  error?: string
  disabled?: boolean
}

export function PlaceSearch({ label, kind, text, onText, place, onPlace, error, disabled }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [forced, setForced] = useState('') // text for which the user pressed Enter (skip the debounce)
  const [recent, setRecent] = useState<Place[]>([])

  const debounced = useDebounced(text, 600)
  const settled = !!place && place.label === text
  const query = settled ? '' : forced === text ? text : debounced
  const search = useGeocoding(query)
  const long = text.trim().length >= 3
  const typing = !settled && long && query.trim() !== text.trim()

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const showRecent = open && !long && recent.length > 0
  const items: Place[] = useMemo(
    () => (showRecent ? recent : long && !settled ? (search.data ?? []) : []),
    [showRecent, recent, long, settled, search.data],
  )

  const choose = (p: Place) => {
    onText(p.label)
    onPlace(p)
    rememberPlace(p)
    setOpen(false)
    setActive(-1)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault()
        choose(items[active])
      } else if (!settled && long) {
        e.preventDefault()
        setForced(text)
        setOpen(true)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const searching = open && !settled && long && (typing || search.isFetching)
  const empty = open && !settled && long && !searching && search.isSuccess && items.length === 0
  const expanded = open && (items.length > 0 || searching || empty || search.isError)

  return (
    <div ref={box} className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={`flex h-11 items-center gap-3 px-3 ${error ? 'bg-[#fdf1f0]' : 'focus-within:bg-accent-soft'} ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
          {kind === 'origin' ? (
            <span className="block h-3 w-3 rounded-full border-[3px] border-ink bg-white" />
          ) : (
            <PinIcon className="text-[#c5221f]" width="20" height="20" />
          )}
        </span>
        <input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={text}
          placeholder={kind === 'origin' ? 'Choose starting point' : 'Choose destination'}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          onFocus={() => {
            setRecent(loadRecent())
            setOpen(true)
          }}
          onChange={(e) => {
            onText(e.target.value)
            if (place) onPlace(null)
            setOpen(true)
            setActive(-1)
          }}
          onKeyDown={onKey}
        />
        {searching && (
          <span className="num text-xs text-ink-3" aria-live="polite">
            Searching…
          </span>
        )}
        {text && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="grid h-7 w-7 place-items-center rounded-[4px] text-ink-3 hover:bg-line-2 hover:text-ink"
            onClick={() => {
              onText('')
              onPlace(null)
              setForced('')
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-err`} className="bg-[#fdf1f0] px-3 pb-2 pl-11 text-[13px] text-[#a31d14]">
          {error}
        </p>
      )}

      {expanded && (
        <div className="absolute left-0 z-[var(--z-dropdown)] mt-px w-full overflow-hidden rounded-b-[var(--radius-box)] border border-line bg-white shadow-[0_8px_24px_rgb(18_22_29/0.18)]">
          {showRecent && (
            <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold text-ink-3">
              <HistoryIcon /> Recent
            </p>
          )}
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
            {items.map((p, i) => {
              const [name, ...rest] = p.label.split(', ')
              return (
                <li
                  key={`${p.lat},${p.lon},${i}`}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(p)
                  }}
                  className={`flex cursor-pointer items-start gap-3 px-3 py-2 ${i === active ? 'bg-panel' : ''}`}
                >
                  <PinIcon className="mt-0.5 shrink-0 text-ink-3" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    {rest.length > 0 && <span className="block truncate text-xs text-ink-3">{rest.join(', ')}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {searching && items.length === 0 && <p className="px-3 py-3 text-sm text-ink-2">Searching places…</p>}
          {empty && (
            <p className="px-3 py-3 text-sm text-ink-2">
              No places match “{text.trim()}”. Try a nearby city or add the state or country.
            </p>
          )}
          {search.isError && !searching && (
            <div className="p-2">
              <ApiErrorState error={search.error} onRetry={() => search.refetch()} compact />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
