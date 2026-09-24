/**
 * Cross-slice contract for the market cell's recording pointer.
 *
 * The READER is `decodeLifecyclePayload` (market/control.ts) — it prefers this key over the
 * marketId formality when deriving the on-chain storage pointer for goLive/setEnded. The WRITER
 * is lifecycle Slice 2 (the recording upload), which has not landed yet.
 *
 * It lives in its own module, imported by name on both sides, so the two halves cannot drift:
 * a writer that picks a different literal would leave the reader silently falling back to the
 * formality with every test still green.
 */
export const RECORDING_POINTER_KEY = "recordingPointer" as const;
