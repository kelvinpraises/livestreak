import { createFileRoute } from '@tanstack/react-router'
import { StreamLayout } from '#/layouts/StreamLayout'
import { mockStreams } from '#/data/mock'

export const Route = createFileRoute('/stream/$id')({
  component: StreamPage,
})

function StreamPage() {
  const { id } = Route.useParams()
  const stream = mockStreams.find(s => s.id === id) ?? mockStreams[0]!

  return (
    <StreamLayout
      streamTitle={stream.title}
      category={stream.category}
      totalPooled={stream.totalPooled}
    />
  )
}
