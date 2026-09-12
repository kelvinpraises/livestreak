import { useState, useRef, useEffect, useCallback } from 'react'

import type { Position } from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { useStreamDraft } from '#/hooks/use-stream-draft'

const COMMIT_DEBOUNCE_MS = 2500
const AUTO_LOCK_MS = 12_000

export interface LaneEditor {
  readonly useOptions: boolean
  /** Slider is unlocked for editing (you clicked ADJUST and it hasn't committed / timed out yet). */
  readonly editing: boolean
  /** A write is in flight. */
  readonly busy: boolean
  /** Last write failure, one human line; null when clear. */
  readonly error: string | null
  /** No active stream but the shared balance is still there to resume from (stopped / switched-away leg). */
  readonly paused: boolean
  /** No active stream and no money left — ran dry or swept. */
  readonly depleted: boolean
  /** Rate to show now — the live drag draft while editing, else the committed on-chain rate. */
  readonly rate: number
  /** Side to show now — the side you're dragging toward (so a switch previews), else the side you hold. */
  readonly shownSide: 'yes' | 'no'
  /** True while streaming a live rate (not paused, not depleted). Draft-aware (drops as you drag to centre). */
  readonly streaming: boolean
  /** Stable "there's a committed live stream to pause" — for the slider's `pausable`, NOT draft-aware. */
  readonly canPause: boolean
  /** Unlock the slider; auto-locks again after AUTO_LOCK_MS of no drag. */
  startEditing: () => void
  /** Slider drag: preview (side, rate) now; commit it COMMIT_DEBOUNCE_MS after you stop moving. */
  onDrag: (side: 'yes' | 'no' | null, rate: number) => void
  /** Pause (drop the lane, keep deposit) / resume (re-add at remembered rate). */
  togglePause: () => void
}

/**
 * Edit / commit / pause state for ONE active stream, lifted out of the row so it stays pure render.
 *
 * Side + rate come from the SAME shared source the vault/niko cards use — `useStreamDraft(vaultId)` over
 * `useVaultView` — so a stream shows identically on every card. This card only adds positions-specific
 * behaviour on top: a debounced auto-commit (no CTA button) and a pause toggle. The slider is a POSITION +
 * RATE control: the side you drag toward is the one committed (`updateLaneRate` drops the old lane and opens
 * the chosen one in one `setLanes`), so dragging YES↔NO switches sides. Dead-centre commits a pause.
 */
export function useLaneEditor(position: Position): LaneEditor {
  const { vaultId, side, streamRate } = position
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected

  // The shared draft: committed side/rate from the global board, overlaid by a local edit while dragging.
  const shared = useStreamDraft(vaultId)
  const { side: sharedSide, rate: sharedRate, editing: drafting, change: previewDraft, clear: clearDraft } = shared

  const [unlocked, setUnlocked] = useState(false) // slider editable (tapped ADJUST); auto-locks after idle
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mockPaused, setMockPaused] = useState(false)

  // Canonical status from the SDK board (paused = stopped but balance remains; depleted = gone); the local
  // toggle is only the demo (fixture) fallback.
  const paused = useOptions ? position.status === 'paused' : mockPaused
  const depleted = position.status === 'depleted'

  // Active stream → shared side/rate (identical to the vault/niko cards). A paused/depleted lane isn't active
  // in the shared view, so fall back to this lane's own remembered side + rate from the share ledger.
  const shownSide = sharedSide ?? side
  const rate = drafting ? sharedRate : sharedSide ? sharedRate : streamRate
  const streaming = rate > 0 && !paused && !depleted
  // Stable: from the COMMITTED status, not the draft rate — so dragging to centre (rate→0) can't flip it and
  // start a pause↔$0.10 oscillation. This is what the slider's `pausable` must use.
  const canPause = useOptions ? position.status === 'streaming' : !depleted && streamRate > 0
  const editing = unlocked

  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    if (lockTimer.current) clearTimeout(lockTimer.current)
  }, [])

  const armAutoLock = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => setUnlocked(false), AUTO_LOCK_MS)
  }, [])

  const startEditing = useCallback(() => {
    if (paused || depleted) return // locked: resume a paused lane via the button, refund a depleted one
    setUnlocked(true)
    armAutoLock()
  }, [paused, depleted, armAutoLock])

  const onDrag = useCallback((nextSide: 'yes' | 'no' | null, nextRate: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    armAutoLock()
    previewDraft(nextSide, nextRate) // preview through the SHARED draft so every card reflects the edit
    // A pausable slider emits `(null, 0)` from its dead centre = PAUSE; a real side+rate = a rate change.
    // Both commit after the debounce so the gesture settles first.
    if (nextSide === null) {
      if (!useOptions) { setMockPaused(true); return }
      commitTimer.current = setTimeout(() => {
        setBusy(true)
        setError(null)
        options.pauseLane(vaultId, side) // drag-to-centre = the Pause button
          .then(() => { setUnlocked(false); clearDraft() })
          .catch((e: unknown) => setError(humanizeWriteError(e)))
          .finally(() => setBusy(false))
      }, COMMIT_DEBOUNCE_MS)
      return
    }
    if (!useOptions) return
    commitTimer.current = setTimeout(() => {
      setBusy(true)
      setError(null)
      options.updateLaneRate(vaultId, nextSide, nextRate)
        .then(() => { setUnlocked(false); clearDraft() })
        .catch((e: unknown) => setError(humanizeWriteError(e)))
        .finally(() => setBusy(false))
    }, COMMIT_DEBOUNCE_MS)
  }, [useOptions, options, vaultId, side, armAutoLock, previewDraft, clearDraft])

  const togglePause = useCallback(() => {
    if (busy) return
    if (!useOptions) { setMockPaused(v => !v); return }
    setBusy(true)
    setError(null)
    // Streaming → pause. Paused OR depleted → resume: `resumeLane` re-funds a depleted lane with a fresh
    // deposit, so depleted isn't a dead-end — the ▶ button revives it (needs USDC on the account).
    const run = canPause ? options.pauseLane : options.resumeLane
    void run(vaultId, side)
      .catch((e: unknown) => setError(humanizeWriteError(e)))
      .finally(() => setBusy(false))
  }, [busy, canPause, useOptions, options, vaultId, side])

  return { useOptions, editing, busy, error, paused, depleted, rate, shownSide, streaming, canPause, startEditing, onDrag, togglePause }
}

/**
 * Turn a raw write/revert into one human line. The contract masks inner reverts behind Safe4337's
 * ExecutionFailed, and the common cases here are a drained side or a vault that already streams a side —
 * name them plainly instead of leaking hex.
 */
export function humanizeWriteError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/not open|resolved/i.test(raw)) return 'This market has resolved — claim your winnings instead of streaming.'
  if (/already funding/i.test(raw)) return 'That side is closed — its deposit ran dry, so it can’t be re-streamed.'
  if (/already has a lane/i.test(raw)) return 'This vault already streams a side — try again to switch.'
  if (/insufficient|deposit/i.test(raw)) return 'Not enough USDC for this stream.'
  if (/rejected|denied/i.test(raw)) return 'Request was rejected.'
  return 'Stream update failed — try again.'
}
