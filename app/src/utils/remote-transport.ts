// The RemoteTransport seam for the Remote Bridge Console (P5).
//
// The console never talks to a bridge directly and holds NO seed: it speaks to the
// host over WSS leg B, which relays to the CLI gateway → owning bridge. Because the
// host leg-B envelope is still being finalised (agent-1 / P4), the console is built
// against THIS interface and exercised with `LocalMockTransport`. `HostWssTransport`
// is a drop-in once leg B lands — same interface, same provider, same renderer.

import {
  bridgeActionScope,
  hasAnyScope,
  type CallActionEnvelope,
  type CapabilityGrant,
  type CapabilityScope,
  type FunctionDescriptor,
} from '@livestreak/schema'

export type RemoteStatus = 'idle' | 'redeeming' | 'connecting' | 'open' | 'closed' | 'error'

// A board is the bridge's live read-model. The console renders it generically, so it
// is intentionally an opaque JSON-serialisable record patched over the wire.
export type RemoteBoard = Record<string, unknown>

export interface RemoteSession {
  readonly sessionToken: string
  readonly grant: CapabilityGrant
}

export interface CallResult {
  readonly ok: boolean
  readonly error?: string
  readonly board?: RemoteBoard
}

export interface RemoteTransport {
  // Password gate → host-signed grant. Throws on bad password / unknown session.
  redeem(session: string, password: string): Promise<RemoteSession>
  // Open leg B for an already-redeemed session.
  connect(session: RemoteSession): Promise<void>
  // Host pushes the in-scope function list (already grant-filtered host-side).
  onFunctions(cb: (functions: readonly FunctionDescriptor[]) => void): () => void
  // Host pushes board patches (full board snapshots in the mock; real impl may diff).
  onPatch(cb: (board: RemoteBoard) => void): () => void
  onStatus(cb: (status: RemoteStatus) => void): () => void
  // Relay a call action envelope; resolves once the bridge has executed.
  send(envelope: CallActionEnvelope): Promise<CallResult>
  disconnect(): void
  readonly status: RemoteStatus
}

// ---------------------------------------------------------------------------
// LocalMockTransport — an in-process stand-in for the host. It holds an in-memory
// functions[] + board (as the real options bridge would expose) and applies relayed
// actions to the board so the whole console renders, validates, invokes and updates
// end-to-end with no network. The redeem step returns a host-shaped grant whose
// scopes gate which functions are advertised (the IN-SCOPE-ONLY rule).
// ---------------------------------------------------------------------------

export interface MockBridgeSeed {
  readonly sessionId: string
  readonly password: string
  // Scopes the redeemed grant carries — controls which functions are in-scope.
  readonly grantScopes: readonly CapabilityScope[]
  readonly functions: readonly FunctionDescriptor[]
  readonly board: RemoteBoard
  // Applies an executed action to the board, returning the next board snapshot.
  readonly apply?: (board: RemoteBoard, envelope: CallActionEnvelope) => RemoteBoard
}

export class LocalMockTransport implements RemoteTransport {
  status: RemoteStatus = 'idle'

  private board: RemoteBoard
  private grant?: CapabilityGrant
  private readonly fnSubs = new Set<(f: readonly FunctionDescriptor[]) => void>()
  private readonly patchSubs = new Set<(b: RemoteBoard) => void>()
  private readonly statusSubs = new Set<(s: RemoteStatus) => void>()

  constructor(private readonly seed: MockBridgeSeed) {
    this.board = seed.board
  }

  private setStatus(status: RemoteStatus): void {
    this.status = status
    for (const cb of this.statusSubs) cb(status)
  }

  // Functions the grant authorises. Host filters server-side; we mirror it defensively
  // so the renderer never shows an out-of-scope control even if a transport misbehaves.
  private inScopeFunctions(): readonly FunctionDescriptor[] {
    const grants = this.grant ? [this.grant] : []
    return this.seed.functions.filter((fn) => hasAnyScope(grants, fn.scope))
  }

  async redeem(session: string, password: string): Promise<RemoteSession> {
    this.setStatus('redeeming')
    await tick()
    if (session !== this.seed.sessionId || password !== this.seed.password) {
      this.setStatus('error')
      throw new Error('Invalid session or password')
    }
    const grant: CapabilityGrant = {
      id: `grant_${session}`,
      sessionId: session,
      holder: 'remote-console',
      scopes: this.seed.grantScopes,
      revoked: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
      sig: 'mock-host-signature',
      hostKeyId: 'mock-host-key',
    }
    this.grant = grant
    return { sessionToken: `tok_${session}`, grant }
  }

  async connect(_session: RemoteSession): Promise<void> {
    this.setStatus('connecting')
    await tick()
    this.setStatus('open')
    // Initial push, as the host would on connect.
    for (const cb of this.fnSubs) cb(this.inScopeFunctions())
    for (const cb of this.patchSubs) cb(this.board)
  }

  onFunctions(cb: (functions: readonly FunctionDescriptor[]) => void): () => void {
    this.fnSubs.add(cb)
    if (this.status === 'open') cb(this.inScopeFunctions())
    return () => this.fnSubs.delete(cb)
  }

  onPatch(cb: (board: RemoteBoard) => void): () => void {
    this.patchSubs.add(cb)
    if (this.status === 'open') cb(this.board)
    return () => this.patchSubs.delete(cb)
  }

  onStatus(cb: (status: RemoteStatus) => void): () => void {
    this.statusSubs.add(cb)
    cb(this.status)
    return () => this.statusSubs.delete(cb)
  }

  async send(envelope: CallActionEnvelope): Promise<CallResult> {
    if (this.status !== 'open') return { ok: false, error: 'Not connected' }
    if (envelope.scope !== bridgeActionScope) {
      return { ok: false, error: `Unexpected scope: ${envelope.scope}` }
    }
    // Authorise against the grant exactly as the host relay would (defence in depth).
    const fn = this.inScopeFunctions().find((f) => f.name === envelope.action)
    if (!fn) return { ok: false, error: 'Action not authorised for this session' }
    await tick()
    if (this.seed.apply) {
      this.board = this.seed.apply(this.board, envelope)
      for (const cb of this.patchSubs) cb(this.board)
    }
    return { ok: true, board: this.board }
  }

  disconnect(): void {
    this.fnSubs.clear()
    this.patchSubs.clear()
    this.setStatus('closed')
    this.statusSubs.clear()
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
