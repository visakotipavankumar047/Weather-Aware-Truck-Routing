import { ApiError } from '../../services/apiClient'
import { AlertIcon, RefreshIcon } from '../layout/icons'

interface Props {
  error: unknown
  onRetry?: () => void
  compact?: boolean
}

function describe(e: unknown): { title: string; body: string; retry: boolean } {
  if (e instanceof ApiError) {
    if (e.status === 0) return { title: 'Connection problem', body: e.message, retry: true }
    if (e.status === 400) return { title: 'Check your input', body: e.message, retry: false }
    if (e.status === 422) {
      return {
        title: 'No drivable route for these points',
        body: `${e.message} Try a different start or destination.`,
        retry: false,
      }
    }
    if (e.status === 404) return { title: 'Not found', body: 'This saved trip no longer exists.', retry: false }
    if (e.status === 429 || e.status === 503) {
      const limited = e.message.includes('rate limit')
      return {
        title: limited ? 'A service is busy' : 'A service refused the request',
        body: limited ? `${e.message} Wait a moment and retry.` : e.message,
        retry: limited,
      }
    }
    if (e.status >= 500) return { title: 'A routing or weather provider failed', body: e.message, retry: true }
    return { title: 'Request failed', body: e.message, retry: false }
  }
  return { title: 'Something went wrong', body: e instanceof Error ? e.message : 'Unexpected error.', retry: false }
}

export function ApiErrorState({ error, onRetry, compact }: Props) {
  const d = describe(error)
  return (
    <div
      role="alert"
      className={`rounded-[var(--radius-box)] border border-[#f0b8b3] bg-[#fdf1f0] text-[#7a1810] ${compact ? 'p-2.5 text-[13px]' : 'p-3.5 text-sm'}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertIcon className="mt-0.5 shrink-0 text-[#b3261e]" />
        <div className="min-w-0">
          <p className="font-semibold">{d.title}</p>
          <p className="mt-0.5 break-words">{d.body}</p>
          {onRetry && d.retry && (
            <button type="button" onClick={onRetry} className="btn btn-sm mt-2">
              <RefreshIcon /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
