// The relay loop — the heart of P3/P6. Per inbound `call` from the host (originated by the browser
// UI on leg B): authorize against the session grant (granular scope + spend cap), then dispatch to
// the OWNING package's bridge WITH the unlocked seed, and return a `call_result`. The seed lives only
// inside the dispatch closure (which holds the seed-bound bridge); it never enters a frame or a log.

import type {
  BridgeCaller,
  CallActionEnvelope,
  CallResultFrame,
  HostCallFrame
} from "@livestreak/schema";
import type { SessionRegistry } from "../session/registry.js";
import { enrichRelayErrorMessage } from "../decode-revert.js";

// Abstracts the package bridge call so the relay never imports chain/seed code directly. The daemon
// supplies a closure bound to the unlocked-seed options bridge.
export type DispatchFn = (
  caller: BridgeCaller,
  envelope: CallActionEnvelope,
  target?: string
) => Promise<{ readonly txId?: string; readonly tokenId?: string }>;

export interface RelayDeps {
  readonly registry: SessionRegistry;
  readonly dispatch: DispatchFn;
  readonly now?: () => number;
  /** Liveness bound per dispatched call — a wedged bridge call must yield an honest error
   *  frame, never silence (chain writes poll up to ~60s; default leaves ample headroom). */
  readonly dispatchTimeoutMs?: number;
}

const DEFAULT_DISPATCH_TIMEOUT_MS = 120_000;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`gateway dispatch timed out after ${ms}ms`)),
          ms
        );
        (timer as { unref?: () => void }).unref?.();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export interface Relay {
  handleCall(frame: HostCallFrame): Promise<CallResultFrame>;
}

export const createRelay = (deps: RelayDeps): Relay => {
  const now = deps.now ?? (() => Date.now());

  const handleCall = async (frame: HostCallFrame): Promise<CallResultFrame> => {
    const base = { type: "call_result" as const, callId: frame.callId, sessionId: frame.sessionId };

    const decision = deps.registry.authorize(frame.sessionId, frame.envelope, now());
    if (!decision.ok) {
      return { ...base, ok: false, error: { message: decision.error ?? "denied" } };
    }

    const record = deps.registry.get(frame.sessionId);
    if (record === undefined) {
      return { ...base, ok: false, error: { message: "unknown session" } };
    }

    try {
      const result = await withTimeout(
        deps.dispatch(deps.registry.callerFor(record), frame.envelope, frame.target),
        deps.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
      );
      deps.registry.commitSpend(frame.sessionId, frame.envelope);
      const payload: { txId?: string; tokenId?: string } = {};
      if (result.txId !== undefined) {
        payload.txId = result.txId;
      }
      if (result.tokenId !== undefined) {
        payload.tokenId = result.tokenId;
      }
      return { ...base, ok: true, result: payload };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        ok: false,
        error: { message: enrichRelayErrorMessage(raw) }
      };
    }
  };

  return { handleCall };
};

// Seed-safety guard: assert a serialized outbound frame never contains the seed bytes/hex. Used by the
// WSS client before every send and exercised directly in tests.
export const assertNoSeedInFrame = (frame: unknown, seed: Uint8Array): void => {
  const json = JSON.stringify(frame);
  const hex = Buffer.from(seed).toString("hex");
  if (hex.length > 0 && json.toLowerCase().includes(hex.toLowerCase())) {
    throw new Error("refusing to send a frame containing seed material");
  }
  const b64 = Buffer.from(seed).toString("base64");
  if (b64.length > 0 && json.includes(b64)) {
    throw new Error("refusing to send a frame containing seed material");
  }
};
