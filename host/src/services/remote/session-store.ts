import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { CapabilityScope, FunctionDescriptor } from "@livestreak/schema";

// --- Remote Bridge Console: in-memory session registry (P4) ---
//
// A session is created by the gateway over leg A (`register`). It carries the
// scope SET the operator chose (the host NEVER invents scopes), an expiry, a
// password verifier (the host stores a verifier, NEVER the plaintext password),
// and the live socket bindings. `/remote/:session/join` only succeeds AFTER the
// gateway registered the session — the host has no scopes/verifier before then.

export type GatewaySink = (frame: unknown) => void;
export type UiSink = (frame: unknown) => void;

export interface RemoteSession {
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly passwordVerifier: string;
  // Gateway-projected, console-normalized function catalog (the UI renders these). Mutable: the
  // gateway re-pushes it on board-first reveals, and late-joining UIs must get the current set.
  functions: readonly FunctionDescriptor[];
  expiresAt: number;
  revoked: boolean;
  /** Latest board snapshot PER package target (replayed to late-joining UIs so EVERY package's board
   *  survives the initial connect, not just whichever package pushed last). */
  lastBoards: Record<string, unknown>;
  gateway: GatewaySink | null;
  /** UI sockets bound to this session, keyed by an internal connection id. */
  readonly uiSinks: Map<string, UiSink>;
  /** Per-UI replay window: highest seq seen + recently seen nonces (bounded). */
  readonly replay: Map<string, { lastSeq: number; nonces: Set<string> }>;
}

export interface RegisterSessionInput {
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly passwordVerifier: string;
  readonly ttlMs: number;
  readonly gateway: GatewaySink;
  readonly functions?: readonly FunctionDescriptor[];
}

const NONCE_WINDOW = 512;

// Verifier format: `scrypt$<saltHex>$<hashHex>`. Deterministic compare via scrypt.
export const makePasswordVerifier = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
};

export const verifyPassword = (verifier: string, password: string): boolean => {
  const parts = verifier.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  try {
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
};

export interface RemoteSessionStore {
  readonly register: (input: RegisterSessionInput) => RemoteSession;
  readonly get: (sessionId: string) => RemoteSession | undefined;
  /** Live = exists, not revoked, not expired. */
  readonly getLive: (sessionId: string, now?: number) => RemoteSession | undefined;
  readonly revoke: (sessionId: string) => RemoteSession | undefined;
  readonly bindUi: (sessionId: string, connId: string, sink: UiSink) => void;
  readonly unbindUi: (sessionId: string, connId: string) => void;
  /** Returns true if (seq, nonce) is fresh for this UI connection; false on replay. */
  readonly checkAndRecordReplay: (
    sessionId: string,
    connId: string,
    seq: number,
    nonce: string
  ) => boolean;
  readonly reapExpired: (now?: number) => readonly string[];
  readonly all: () => readonly RemoteSession[];
}

export const createRemoteSessionStore = (): RemoteSessionStore => {
  const sessions = new Map<string, RemoteSession>();

  const register = (input: RegisterSessionInput): RemoteSession => {
    const existing = sessions.get(input.sessionId);
    if (existing !== undefined) {
      existing.gateway = input.gateway;
    }
    const session: RemoteSession = existing ?? {
      sessionId: input.sessionId,
      scopes: input.scopes,
      passwordVerifier: input.passwordVerifier,
      functions: input.functions ?? [],
      expiresAt: Date.now() + input.ttlMs,
      revoked: false,
      gateway: input.gateway,
      uiSinks: new Map(),
      replay: new Map(),
      lastBoards: {}
    };
    sessions.set(session.sessionId, session);
    return session;
  };

  const get = (sessionId: string): RemoteSession | undefined => sessions.get(sessionId);

  const getLive = (sessionId: string, now = Date.now()): RemoteSession | undefined => {
    const session = sessions.get(sessionId);
    if (session === undefined || session.revoked || session.expiresAt <= now) {
      return undefined;
    }
    return session;
  };

  const revoke = (sessionId: string): RemoteSession | undefined => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.revoked = true;
    return session;
  };

  const bindUi = (sessionId: string, connId: string, sink: UiSink): void => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.uiSinks.set(connId, sink);
    session.replay.set(connId, { lastSeq: -1, nonces: new Set() });
  };

  const unbindUi = (sessionId: string, connId: string): void => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.uiSinks.delete(connId);
    session.replay.delete(connId);
  };

  const checkAndRecordReplay = (
    sessionId: string,
    connId: string,
    seq: number,
    nonce: string
  ): boolean => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return false;
    }
    const window = session.replay.get(connId);
    if (window === undefined) {
      return false;
    }
    // Strictly monotonic seq per socket + unseen nonce.
    if (seq <= window.lastSeq || window.nonces.has(nonce)) {
      return false;
    }
    window.lastSeq = seq;
    window.nonces.add(nonce);
    if (window.nonces.size > NONCE_WINDOW) {
      const first = window.nonces.values().next().value;
      if (first !== undefined) {
        window.nonces.delete(first);
      }
    }
    return true;
  };

  const reapExpired = (now = Date.now()): readonly string[] => {
    const reaped: string[] = [];
    for (const session of sessions.values()) {
      if (!session.revoked && session.expiresAt <= now) {
        session.revoked = true;
        reaped.push(session.sessionId);
      }
    }
    return reaped;
  };

  const all = (): readonly RemoteSession[] => [...sessions.values()];

  return {
    register,
    get,
    getLive,
    revoke,
    bindUi,
    unbindUi,
    checkAndRecordReplay,
    reapExpired,
    all
  };
};
