import { createFileRoute } from '@tanstack/react-router'
import { RemoteProvider } from '#/providers/remote-provider'
import { RemoteConsole } from '#/components/template/remote-console'

// Password-gated Remote Bridge Console at /remote/<session> (P5). Auto-registers via
// TanStack file-routing. The console opens leg B via a RemoteTransport (local mock in
// dev; HostWssTransport once host ships the leg-B envelope), redeems the session behind
// a password gate, then renders auto-forms from the bridge's in-scope functions[].
export const Route = createFileRoute('/remote/$session')({
  component: RemoteConsolePage,
})

function RemoteConsolePage() {
  const { session } = Route.useParams()
  return (
    <RemoteProvider session={session}>
      <RemoteConsole />
    </RemoteProvider>
  )
}
