import { LiveStreakConfigError } from "@livestreak/core";

// --- Direct-stream signaling (the host's ONLY jobs on the direct lane; zero media bytes) ---
//
//   echo      dial the broadcaster back from OUTSIDE — the reachability truth its go-live gate needs
//   announce  publish the broadcaster's watch URL so viewers can find the direct door
//
// Announce ownership: the first announce for a stream mints a key returned ONLY to the announcer;
// while the record is fresh, refreshing or withdrawing it requires that key — one curl cannot
// redirect a live stream's viewers. Records expire (TTL) unless the broadcaster heartbeats, so a
// crashed broadcaster's dead door disappears instead of stranding viewers forever.
// The echo only ever dials the CALLER's own observed address — it cannot be pointed at third
// parties, so it is not a port-scan/SSRF primitive.

export interface DirectAnnounce {
  readonly streamId: string;
  readonly watchUrl: string;
  readonly announcedAtMs: number;
  readonly expiresAtMs: number;
}

export type AnnounceOutcome =
  | { readonly ok: true; readonly record: DirectAnnounce; readonly key: string; readonly refreshed: boolean }
  | { readonly ok: false; readonly reason: "conflict" };

export interface DirectAnnounceStore {
  readonly announce: (streamId: string, watchUrl: string, key?: string) => AnnounceOutcome;
  readonly lookup: (streamId: string) => DirectAnnounce | undefined;
  readonly withdraw: (streamId: string, key?: string) => { withdrawn: boolean; denied: boolean };
}

const MAX_ANNOUNCES = 500;
export const ANNOUNCE_TTL_MS = 90_000;

interface AnnounceRecord extends DirectAnnounce {
  readonly key: string;
}

const publicRecord = ({ key: _key, ...record }: AnnounceRecord): DirectAnnounce => record;

export const createDirectAnnounceStore = (now: () => number = Date.now): DirectAnnounceStore => {
  const announces = new Map<string, AnnounceRecord>();

  const fresh = (streamId: string): AnnounceRecord | undefined => {
    const record = announces.get(streamId);
    if (record === undefined) return undefined;
    if (record.expiresAtMs <= now()) {
      announces.delete(streamId);
      return undefined;
    }
    return record;
  };

  return {
    announce: (streamId, watchUrl, key) => {
      const existing = fresh(streamId);
      if (existing !== undefined && existing.key !== key) {
        return { ok: false, reason: "conflict" };
      }
      // Bounded: evict the oldest announce rather than grow without limit (announces are
      // live-session ephemera protected by the TTL anyway).
      if (existing === undefined && announces.size >= MAX_ANNOUNCES) {
        const oldest = announces.keys().next().value;
        if (oldest !== undefined) announces.delete(oldest);
      }
      const atMs = now();
      const record: AnnounceRecord = {
        streamId,
        watchUrl,
        announcedAtMs: existing?.announcedAtMs ?? atMs,
        expiresAtMs: atMs + ANNOUNCE_TTL_MS,
        key: existing?.key ?? globalThis.crypto.randomUUID()
      };
      announces.set(streamId, record);
      return { ok: true, record: publicRecord(record), key: record.key, refreshed: existing !== undefined };
    },
    lookup: (streamId) => {
      const record = fresh(streamId);
      return record === undefined ? undefined : publicRecord(record);
    },
    withdraw: (streamId, key) => {
      const record = fresh(streamId);
      if (record === undefined) return { withdrawn: false, denied: false };
      if (record.key !== key) return { withdrawn: false, denied: true };
      announces.delete(streamId);
      return { withdrawn: true, denied: false };
    }
  };
};

export type DirectRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

const failure = (status: number, message: string): DirectRouteResponse<never> => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message })
});

export const handleDirectAnnounce = (
  streamId: string,
  body: unknown,
  store: DirectAnnounceStore
): DirectRouteResponse<DirectAnnounce & { readonly key: string }> => {
  if (streamId.trim().length === 0) {
    return failure(400, "streamId is required");
  }
  const record = (body ?? {}) as { watchUrl?: unknown; key?: unknown };
  if (typeof record.watchUrl !== "string" || !/^wss?:\/\//.test(record.watchUrl)) {
    return failure(400, "watchUrl must be a ws:// or wss:// URL");
  }
  if (record.key !== undefined && typeof record.key !== "string") {
    return failure(400, "key must be a string when present");
  }
  const outcome = store.announce(streamId.trim(), record.watchUrl, record.key);
  if (!outcome.ok) {
    return failure(409, `Stream "${streamId}" is already announced by another broadcaster`);
  }
  // The key rides only in this response (the announcer's receipt); lookups never expose it.
  return {
    ok: true,
    status: outcome.refreshed ? 200 : 201,
    result: { ...outcome.record, key: outcome.key }
  };
};

export const handleDirectLookup = (
  streamId: string,
  store: DirectAnnounceStore
): DirectRouteResponse<DirectAnnounce> => {
  const found = store.lookup(streamId);
  if (found === undefined) {
    return failure(404, `No direct announce for stream "${streamId}"`);
  }
  return { ok: true, status: 200, result: found };
};

export const handleDirectWithdraw = (
  streamId: string,
  body: unknown,
  store: DirectAnnounceStore
): DirectRouteResponse<{ readonly withdrawn: boolean }> => {
  const key = (body ?? {}) as { key?: unknown };
  const outcome = store.withdraw(streamId, typeof key.key === "string" ? key.key : undefined);
  if (outcome.denied) {
    return failure(403, `Withdrawing stream "${streamId}" requires the announce key`);
  }
  return { ok: true, status: 200, result: { withdrawn: outcome.withdrawn } };
};

export interface ReachabilityEchoResult {
  readonly reachable: boolean;
  readonly dialedIp: string;
  readonly dialedPort: number;
}

/** Injectable TCP dialer (tests fake it); resolves true when the handshake completes in time. */
export type TcpDialer = (ip: string, port: number, timeoutMs: number) => Promise<boolean>;

export const tcpDial: TcpDialer = async (ip, port, timeoutMs) => {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port });
    const done = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
};

export const handleReachabilityEcho = async (
  body: unknown,
  callerIp: string | undefined,
  dial: TcpDialer = tcpDial
): Promise<DirectRouteResponse<ReachabilityEchoResult>> => {
  const port = (body as { port?: unknown } | null)?.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return failure(400, "port must be an integer in 1..65535");
  }
  if (callerIp === undefined || callerIp.length === 0) {
    return failure(400, "Could not determine the caller's address");
  }
  // Only the caller's own observed address is ever dialed (see the auth-posture note above).
  const ip = normalizeIp(callerIp);
  const reachable = await dial(ip, port, 3_000);
  return { ok: true, status: 200, result: { reachable, dialedIp: ip, dialedPort: port } };
};

// Express reports IPv4 peers as IPv6-mapped ("::ffff:84.12.9.3"); unwrap for the dial-back.
const normalizeIp = (ip: string): string =>
  ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
