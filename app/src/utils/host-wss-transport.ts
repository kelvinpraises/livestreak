// HostWssTransport — leg-B client for the Remote Bridge Console (P5).
//
// Speaks the canonical wire protocol from `@livestreak/schema`:
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
  readonly retryDelaysMs?: readonly number[]
  readonly readyTimeoutMs?: number
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
  private board: RemoteBoard = {}
  private readonly pending = new Map<string, (r: CallResult) => void>()
  private onReady?: () => void
  private rejectReady?: (error: Error) => void
  private readyTimer?: ReturnType<typeof setTimeout>
  private retryTimer?: ReturnType<typeof setTimeout>
  private expiryTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private hadReady = false
  private attempt = 0
  private readonly retryDelays: readonly number[]
  private readonly readyTimeout: number

  constructor(opts: HostWssTransportOptions) {
    this.retryDelays = opts.retryDelaysMs ?? [500, 1000, 2000, 4000, 8000, 8000, 8000]
    this.readyTimeout = opts.readyTimeoutMs ?? 5000
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
    clearTimeout(this.retryTimer)
    clearTimeout(this.readyTimer)
    const oldSocket = this.ws
    this.ws = undefined
    oldSocket?.close()
    this.stopped = false
    this.hadReady = false
    this.attempt = 0
    this.grant = session.grant
    this.sessionId = session.grant.sessionId
    clearTimeout(this.expiryTimer)
    if (this.grant.expiresAt !== undefined && this.grant.expiresAt <= Date.now()) {
      this.terminate('expired'); throw new Error('Session expired')
    }
    this.armExpiry()
    this.setStatus('connecting')
    await this.openSocket()
  }

  private armExpiry(): void {
    if (this.grant?.expiresAt === undefined || this.stopped) return
    const remaining = this.grant.expiresAt - Date.now()
    if (remaining <= 0) { this.terminate('expired'); return }
    this.expiryTimer = setTimeout(() => this.armExpiry(), Math.min(remaining, 2_147_483_647))
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ws: WebSocketLike
      try { ws = this.makeSocket(`${this.wsBase}/remote/${encodeURIComponent(this.sessionId)}/ui`) }
      catch (error) { this.terminate('unavailable'); reject(error); return }
      this.ws = ws
      this.rejectReady = reject
      this.onReady = () => { clearTimeout(this.readyTimer); this.rejectReady = undefined; resolve() }
      this.readyTimer = setTimeout(() => {
        if (this.ws !== ws || this.stopped) return
        reject(new Error('timed out waiting for host ready'))
        this.lostSocket(ws)
      }, this.readyTimeout)
      ws.addEventListener('open', () => {
        if (this.ws !== ws || this.stopped) return
        ws.send(JSON.stringify({ type: 'ui.hello', sessionId: this.sessionId, grant: this.grant, seq: 0 }))
      })
      ws.addEventListener('message', (ev: { data: unknown }) => {
        if (this.ws === ws && !this.stopped) this.onMessage(ev.data)
      })
      ws.addEventListener('close', () => this.lostSocket(ws))
      ws.addEventListener('error', () => this.lostSocket(ws))
    })
  }

  private terminate(status: RemoteStatus): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.readyTimer)
    clearTimeout(this.expiryTimer)
    this.rejectReady?.(new Error(`Session ${status}`))
    this.rejectReady = undefined
    this.failPending()
    const ws = this.ws
    this.ws = undefined
    this.setStatus(status)
    ws?.close()
  }

  private failPending(): void {
    for (const resolve of this.pending.values()) resolve({
      ok: false, error: 'Connection interrupted. Outcome unknown: refresh and check the board or chain receipt before retrying. This action was not resent.',
    })
    this.pending.clear()
  }

  private lostSocket(ws: WebSocketLike): void {
    if (this.ws !== ws || this.stopped) return
    this.ws = undefined
    ws.close()
    clearTimeout(this.readyTimer)
    this.rejectReady?.(new Error('Connection interrupted'))
    this.rejectReady = undefined
    this.failPending()
    if (!this.hadReady) { this.setStatus('error'); return }
    if (this.grant?.expiresAt !== undefined && this.grant.expiresAt <= Date.now()) { this.terminate('expired'); return }
    const delay = this.retryDelays[this.attempt++]
    if (delay === undefined) { this.terminate('unavailable'); return }
    this.setStatus('reconnecting')
    this.retryTimer = setTimeout(() => {
      if (this.stopped) return
      void this.openSocket().catch(() => { /* lostSocket schedules the bounded next attempt */ })
    }, delay)
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
        this.board = { ...(f.boards ?? {}) }
        for (const cb of this.patchSubs) cb({ ...this.board })
        this.seq = 0
        this.hadReady = true
        this.attempt = 0
        this.setStatus('open')
        for (const cb of this.fnSubs) cb(this.functions)
        this.onReady?.()
        return
      case 'functions':
        this.functions = f.functions
        for (const cb of this.fnSubs) cb(this.functions)
        return
      case 'board_patch':
        this.applyBoardPatch(f.target, f.board)
        for (const cb of this.patchSubs) cb({ ...this.board })
        return
      case 'call_result': {
        const resolve = this.pending.get(f.callId)
        if (resolve) {
          this.pending.delete(f.callId)
          resolve(
            f.ok
              ? // Keep the gateway's outcome ({txId, tokenId}) — mint feedback depends on it.
                { ok: true, ...(f.result === undefined ? {} : { result: f.result }) }
              : { ok: false, error: f.error?.message ?? 'call failed' },
          )
        }
        return
      }
      case 'revoked':
        this.terminate(f.reason === 'ttl_expired' ? 'expired' : 'revoked')
        return
      case 'error':
        if (f.code === -32010 || f.message?.includes('gateway disconnected')) {
          if (this.ws) this.lostSocket(this.ws)
          return
        }
        if (f.code === -32004) { this.terminate('unavailable'); return }
        if (f.code === -32403) { this.terminate('revoked'); return }
        if (this.status !== 'open') this.terminate('error')
        return
    }
  }

  onFunctions(cb: (functions: readonly FunctionDescriptor[]) => void): () => void {
    this.fnSubs.add(cb)
    if (this.status === 'open') cb(this.functions)
    return () => this.fnSubs.delete(cb)
  }

  onPatch(cb: (board: RemoteBoard) => void): () => void {
    this.patchSubs.add(cb)
    if (Object.keys(this.board).length > 0) cb({ ...this.board })
    return () => this.patchSubs.delete(cb)
  }

  private applyBoardPatch(target: string | undefined, patch: unknown): void {
    if (target) {
      this.board = { ...this.board, [target]: patch }
      return
    }
    if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
      this.board = { ...(patch as RemoteBoard) }
    }
  }

  onStatus(cb: (status: RemoteStatus) => void): () => void {
    this.statusSubs.add(cb)
    cb(this.status)
    return () => this.statusSubs.delete(cb)
  }

  send(envelope: CallActionEnvelope, target?: string): Promise<CallResult> {
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
      ...(target ? { target } : {}),
      envelope: {
        scope: envelope.scope,
        action: envelope.action,
        ...(envelope.id === undefined ? {} : { id: envelope.id }),
        args: envelope.args,
      },
    }
    return new Promise<CallResult>((resolve) => {
      // Liveness bound: a call the gateway never answers must resolve to an honest error, not a
      // silent forever-pending card. Longer than the gateway's own dispatch timeout so the
      // relay's more specific error wins whenever the gateway is alive.
      const timer = setTimeout(() => {
        if (this.pending.delete(callId)) {
          resolve({ ok: false, error: 'no response from gateway (timed out)' })
        }
      }, 150_000)
      this.pending.set(callId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      try {
        this.ws!.send(JSON.stringify(frame))
      } catch {
        clearTimeout(timer)
        this.pending.delete(callId)
        resolve({ ok: false, error: 'failed to send' })
      }
    })
  }

  disconnect(): void {
    const wasActive = this.hadReady
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.readyTimer)
    clearTimeout(this.expiryTimer)
    this.rejectReady?.(new Error('Disconnected'))
    this.rejectReady = undefined
    this.failPending()
    const ws = this.ws
    this.ws = undefined
    ws?.close(1000, 'client disconnect')
    if (wasActive) this.setStatus('closed')
    this.fnSubs.clear()
    this.patchSubs.clear()
    this.statusSubs.clear()
  }

  private toHttpJoin(session: string): string {
    const httpBase = this.wsBase.replace(/^ws/, 'http')
    return `${httpBase}/remote/${encodeURIComponent(session)}/join`
  }
}
