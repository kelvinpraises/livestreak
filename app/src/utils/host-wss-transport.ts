// HostWssTransport — the REAL leg-B client for the Remote Bridge Console (P5).
//
// Implements the same `RemoteTransport` interface as `LocalMockTransport`, so it drops into
// `RemoteProvider` unchanged. It speaks the ONE canonical wire protocol from `@livestreak/schema`:
//   redeem  → POST /remote/:session/join (password → host-signed grant)
//   connect → open WSS to /remote/:session/ui, send ui.hello{grant, seq:0}, await `ready` (+ functions)
//   send    → call{callId, seq, nonce, envelope} → await the matching call_result
// Host pushes (`functions` / `ready.functions`, `board_patch`, `revoked`, `error`) fan out to the
// onFunctions/onPatch/onStatus subscribers. The browser holds NO seed — it only triggers the gateway.

import {
  isUiServerFrame,
  type CallActionEnvelope,
  type CapabilityGrant,
  type FunctionDescriptor,
  type UiServerFrame,
} from '@livestreak/schema'
import type {
  CallResult,
  RemoteBoard,
  RemoteSession,
  RemoteStatus,
  RemoteTransport,
} from './remote-transport'

// Minimal structural WebSocket so we can inject `ws` in node tests and use the global in the browser.
export interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  readyState: number
}
export type WebSocketFactory = (url: string) => WebSocketLike

export interface HostWssTransportOptions {
  // Host HTTP origin, e.g. http://127.0.0.1:8787 (ws URL is derived by swapping the scheme).
  readonly hostBaseUrl: string
  readonly fetchImpl?: typeof fetch
  readonly webSocketFactory?: WebSocketFactory
}

const toWsBase = (httpBase: string): string => httpBase.replace(/^http/, 'ws').replace(/\/$/, '')

const randomNonce = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export class HostWssTransport implements RemoteTransport {
  status: RemoteStatus = 'idle'

  private ws?: WebSocketLike
  private grant?: CapabilityGrant
  private sessionId = ''
  private seq = 0
  private readonly fetchImpl: typeof fetch
  private readonly makeSocket: WebSocketFactory
  private readonly wsBase: string

  private readonly fnSubs = new Set<(f: readonly FunctionDescriptor[]) => void>()
  private readonly patchSubs = new Set<(b: RemoteBoard) => void>()
  private readonly statusSubs = new Set<(s: RemoteStatus) => void>()
  private functions: readonly FunctionDescriptor[] = []
  private readonly pending = new Map<string, (r: CallResult) => void>()
  private onReady?: () => void

  constructor(opts: HostWssTransportOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.wsBase = toWsBase(opts.hostBaseUrl)
    this.makeSocket =
      opts.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike)
  }

  private setStatus(status: RemoteStatus): void {
    this.status = status
    for (const cb of this.statusSubs) cb(status)
  }

  async redeem(session: string, password: string): Promise<RemoteSession> {
    this.setStatus('redeeming')
    this.sessionId = session
    let res: Response
    try {
      res = await this.fetchImpl(`${this.toHttpJoin(session)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
    } catch (err) {
      this.setStatus('error')
      throw err instanceof Error ? err : new Error('join request failed')
    }
    if (!res.ok) {
      this.setStatus('error')
      throw new Error(res.status === 401 ? 'Invalid password' : `Session not available (${res.status})`)
    }
    const body = (await res.json()) as { grant: CapabilityGrant }
    this.grant = body.grant
    return { sessionToken: body.grant.id, grant: body.grant }
  }

  async connect(session: RemoteSession): Promise<void> {
    this.grant = session.grant
    this.sessionId = session.grant.sessionId
    this.setStatus('connecting')
    const ws = this.makeSocket(`${this.wsBase}/remote/${encodeURIComponent(this.sessionId)}/ui`)
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      const readyTimer = setTimeout(() => reject(new Error('timed out waiting for host ready')), 10_000)
      this.onReady = () => {
        clearTimeout(readyTimer)
        resolve()
      }
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'ui.hello', sessionId: this.sessionId, grant: this.grant, seq: 0 }))
      })
      ws.addEventListener('message', (ev: { data: unknown }) => this.onMessage(ev.data))
      ws.addEventListener('close', () => this.onClose())
      ws.addEventListener('error', () => {
        clearTimeout(readyTimer)
        reject(new Error('leg-B socket error'))
      })
    })
  }

  private onMessage(data: unknown): void {
    let frame: unknown
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      return
    }
    if (!isUiServerFrame(frame)) return
    const f = frame as UiServerFrame
    switch (f.type) {
      case 'ready':
        this.functions = f.functions ?? []
        this.setStatus('open')
        for (const cb of this.fnSubs) cb(this.functions)
        this.onReady?.()
        return
      case 'functions':
        this.functions = f.functions
        for (const cb of this.fnSubs) cb(this.functions)
        return
      case 'board_patch':
        for (const cb of this.patchSubs) cb((f.board ?? {}) as RemoteBoard)
        return
      case 'call_result': {
        const resolve = this.pending.get(f.callId)
        if (resolve) {
          this.pending.delete(f.callId)
          resolve(f.ok ? { ok: true } : { ok: false, error: f.error?.message ?? 'call failed' })
        }
        return
      }
      case 'revoked':
        this.setStatus('closed')
        this.ws?.close(4403, 'revoked')
        return
      case 'error':
        // A transport-level error frame; surface as status without tearing down a healthy session.
        if (this.status !== 'open') this.setStatus('error')
        return
    }
  }

  private onClose(): void {
    if (this.status !== 'closed') this.setStatus('closed')
    for (const [, resolve] of this.pending) resolve({ ok: false, error: 'connection closed' })
    this.pending.clear()
  }

  onFunctions(cb: (functions: readonly FunctionDescriptor[]) => void): () => void {
    this.fnSubs.add(cb)
    if (this.status === 'open') cb(this.functions)
    return () => this.fnSubs.delete(cb)
  }

  onPatch(cb: (board: RemoteBoard) => void): () => void {
    this.patchSubs.add(cb)
    return () => this.patchSubs.delete(cb)
  }

  onStatus(cb: (status: RemoteStatus) => void): () => void {
    this.statusSubs.add(cb)
    cb(this.status)
    return () => this.statusSubs.delete(cb)
  }

  send(envelope: CallActionEnvelope): Promise<CallResult> {
    if (this.status !== 'open' || !this.ws) {
      return Promise.resolve({ ok: false, error: 'Not connected' })
    }
    const callId = randomNonce()
    this.seq += 1
    const frame = {
      type: 'call' as const,
      callId,
      seq: this.seq,
      nonce: randomNonce(),
      envelope: { scope: envelope.scope, action: envelope.action, args: envelope.args },
    }
    return new Promise<CallResult>((resolve) => {
      this.pending.set(callId, resolve)
      try {
        this.ws!.send(JSON.stringify(frame))
      } catch {
        this.pending.delete(callId)
        resolve({ ok: false, error: 'failed to send' })
      }
    })
  }

  disconnect(): void {
    this.fnSubs.clear()
    this.patchSubs.clear()
    this.ws?.close(1000, 'client disconnect')
    this.setStatus('closed')
    this.statusSubs.clear()
  }

  private toHttpJoin(session: string): string {
    const httpBase = this.wsBase.replace(/^ws/, 'http')
    return `${httpBase}/remote/${encodeURIComponent(session)}/join`
  }
}
