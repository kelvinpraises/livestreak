/** Reserved market-bound recording metadata; Flow07 supplies the verified writer. */
export const RECORDING_POINTER_KEY = "recordingPointer" as const;

/** Ended + scheme 0 + empty id represents no recording across all three chains. */
export const NO_RECORDING_POINTER_ID = "" as const;
/** Read-only compatibility with the unaccepted historical marker. Never write it. */
export const LEGACY_NO_RECORDING_POINTER_ID = "livestreak:no-recording" as const;
