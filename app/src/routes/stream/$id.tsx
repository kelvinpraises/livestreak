import { createFileRoute } from '@tanstack/react-router'
import { StreamLayout } from '#/components/template/stream-layout'
import { useStreamMeta } from '#/hooks/use-stream-meta'

export const Route = createFileRoute('/stream/$id')({
  component: StreamPage,
})

function StreamPage() {
  const { id } = Route.useParams()
  const stream = useStreamMeta(id)

  return (
    <StreamLayout
      streamTitle={stream.title}
      category={stream.category}
      totalPooled={stream.totalPooled}
      totalPooledRatePerSec={stream.totalPooledRatePerSec}
      streamId={id}
    />
  )
}
