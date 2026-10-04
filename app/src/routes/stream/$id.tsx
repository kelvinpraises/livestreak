import { createFileRoute } from '@tanstack/react-router'
import { StreamLayout } from '#/components/template/stream-layout'
import { useStreamMeta } from '#/hooks/use-stream-meta'
import { useHostStream } from '#/hooks/use-host-stream'

export const Route = createFileRoute('/stream/$id')({
  validateSearch: (search: Record<string, unknown>): { vault?: string; chain?: 'evm' | 'sui' | 'solana' } => ({ chain: search.chain === 'evm' || search.chain === 'sui' || search.chain === 'solana' ? search.chain : undefined, vault: typeof search.vault === 'string' ? search.vault : undefined }),
  component: StreamPage,
})

function StreamPage() {
  const { id } = Route.useParams()
  const { vault, chain } = Route.useSearch()
  const hostStream = useHostStream(id, chain)
  const stream = useStreamMeta(id, hostStream.stream)

  return (
    <StreamLayout
      streamTitle={stream.title}
      category={stream.category}
      totalPooled={stream.totalPooled}
      totalPooledRatePerSec={stream.totalPooledRatePerSec}
      streamId={id}
      requestedVaultId={vault}
      hostStream={hostStream}
    />
  )
}
