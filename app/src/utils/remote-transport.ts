// The RemoteTransport seam for the Remote Bridge Console (P5).
//
// The console never talks to a bridge directly and holds NO seed: it speaks to the
// host over WSS leg B, which relays to the CLI gateway → owning package bridge.

import type {
  CallActionEnvelope,
  CapabilityGrant,
  FunctionDescriptor,
  RemoteCallOutcome,
} from '@livestreak/schema'

export type RemoteStatus = 'idle' | 'redeeming' | 'connecting' | 'open' | 'closed' | 'error'

// Per-package board snapshots keyed by ConsolePackage name (`options`, `observe`, …).
// Host `board_patch` frames carry a `target` package id; the transport merges into here.
export type RemoteBoard = Record<string, unknown>

export interface RemoteSession {
  readonly sessionToken: string
  readonly grant: CapabilityGrant
}

export interface CallResult {
  readonly ok: boolean
  readonly error?: string
  readonly board?: RemoteBoard
  // The gateway's call outcome (e.g. mint's {txId, tokenId}) — surfaced so the console can confirm.
  readonly result?: RemoteCallOutcome
}

export interface RemoteTransport {
  // Password gate → host-signed grant. Throws on bad password / unknown session.
  redeem(session: string, password: string): Promise<RemoteSession>
  // Open leg B for an already-redeemed session.
  connect(session: RemoteSession): Promise<void>
  // Host pushes the in-scope function list (already grant-filtered host-side).
  onFunctions(cb: (functions: readonly FunctionDescriptor[]) => void): () => void
  // Host pushes board patches keyed by package target.
  onPatch(cb: (board: RemoteBoard) => void): () => void
  onStatus(cb: (status: RemoteStatus) => void): () => void
  // Relay a call action envelope; `target` is the owning package on the wire (UiCallFrame.target).
  send(envelope: CallActionEnvelope, target?: string): Promise<CallResult>
  disconnect(): void
  readonly status: RemoteStatus
}
