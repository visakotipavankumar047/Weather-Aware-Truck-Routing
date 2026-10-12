import { useQuery } from '@tanstack/react-query'
import { health } from '../../services/trips'

export function ApiStatus() {
  const { data, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: health,
    refetchInterval: 30000,
    retry: false,
  })
  const online = data?.status === 'ok'
  return (
    <p
      role="status"
      title={online ? 'Backend API is reachable' : 'Backend API is not reachable'}
      className="flex items-center gap-1.5 text-xs font-medium text-ink-2"
    >
      <span
        className={`h-2 w-2 rounded-full ${online ? 'bg-[#23863f]' : isPending ? 'bg-[#8a94a3]' : 'bg-[#d93025]'}`}
        aria-hidden="true"
      />
      {online ? 'Connected' : isPending ? 'Connecting' : 'Backend offline'}
      {online && data?.persistent === false && (
        <span className="rounded-[3px] bg-[#fdf6dd] px-1.5 py-0.5 text-[#5c4300]" title="No persistent database is configured: saved trips are lost when the server restarts. Set DATABASE_URL.">
          trips not saved
        </span>
      )}
    </p>
  )
}
