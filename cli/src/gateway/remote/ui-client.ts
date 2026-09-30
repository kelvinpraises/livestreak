// Leg-B client for headless remote-console automation and the public agent surface.
// The gateway keeps the signer; this client only redeems a pairing grant and calls
// scope-permitted actions through Host. Re-exported via src/agent-client.ts.

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  bridgeActionScope,
  isUiServerFrame,
  type CallActionEnvelope,
  type CapabilityGrant,
  type FunctionDescriptor,
  type UiServerFrame
} from "@livestreak/schema";
import { enrichRelayErrorMessage } from "../decode-revert.js";

export type RemoteDriveTarget = "observe" | "options" | "steward" | "bookmaker";

export interface RemoteUiClientOptions {
  readonly hostBaseUrl: string;
  readonly sessionId: string;
  readonly pairingPassword: string;
  readonly log?: (line: string) => void;
}

export interface RemoteCallOutcome {
  readonly ok: boolean;
  readonly result?: { readonly txId?: string; readonly tokenId?: string };
  readonly error?: string;
}

export interface RemoteUiClient {
  connect(): Promise<void>;
  /** `id` is the optional cell-qualified descriptor id (e.g. "observe.sink.direct.configure") —
   *  needed when a package's cells share a fn name; authz stays keyed on the bare action. */
  call(target: RemoteDriveTarget, action: string, args?: unknown, id?: string): Promise<RemoteCallOutcome>;
  boards(): Readonly<Record<string, unknown>>;
  /** Scope-filtered function catalog last pushed by Host (empty until `ready`). */
  functions(): ReadonlyArray<FunctionDescriptor>;
  close(): void;
}

// ponytail: prefix-match classifier, richer codes only if Host starts sending them.
/** Classify a failed-call message so callers can tell denial from revocation without parsing. */
export const classifyRemoteError = (message: string): string => {
  if (/revok|expir|grant.*no longer|session.*clos|session.*end/i.test(message)) {
    return `revoked-or-expired: ${message}`;
  }
  if (/denied|not permitted|out of scope|forbidden|unauthorized|scope/i.test(message)) {
    return `scope-denied: ${message}`;
  }
  return message;
};

const toWsBase = (httpBase: string): string => httpBase.replace(/^http/, "ws").replace(/\/$/, "");

const toHttpBase = (url: string): string => url.replace(/^ws/, "http").replace(/\/$/, "");

export const createRemoteUiClient = (opts: RemoteUiClientOptions): RemoteUiClient => {
  const log = opts.log ?? (() => {});
  const httpBase = toHttpBase(opts.hostBaseUrl);
  const wsBase = toWsBase(opts.hostBaseUrl);
  let ws: WebSocket | undefined;
  let grant: CapabilityGrant | undefined;
  // Set on an explicit host `revoked` frame; survives socket close so later
  // calls report revocation instead of generic transport loss.
  let closedReason: "revoked" | undefined;
  let seq = 0;
  const boards: Record<string, unknown> = {};
  let seenFunctions: readonly FunctionDescriptor[] = [];
  const pending = new Map<string, (outcome: RemoteCallOutcome) => void>();

  // ponytail: clock check only, richer server expiry codes if Host ever sends them.
  const grantExpired = (): boolean =>
    grant?.expiresAt !== undefined && Date.now() >= grant.expiresAt;


  const applyBoardPatch = (target: string | undefined, patch: unknown): void => {
    if (target !== undefined) {
      boards[target] = patch;
      return;
    }
    if (patch !== null && typeof patch === "object" && !Array.isArray(patch)) {
      Object.assign(boards, patch as Record<string, unknown>);
    }
  };

  const onMessage = (data: WebSocket.RawData): void => {
    let frame: unknown;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!isUiServerFrame(frame)) {
      return;
    }
    const f = frame as UiServerFrame;
    switch (f.type) {
      case "board_patch":
        applyBoardPatch(f.target, f.board);
        return;
      case "functions":
        seenFunctions = f.functions;
        return;
      case "call_result": {
        const resolve = pending.get(f.callId);
        if (resolve === undefined) {
          return;
        }
        pending.delete(f.callId);
        const rawMessage =
          f.ok === false && f.error?.message !== undefined
            ? enrichRelayErrorMessage(f.error.message)
            : f.error?.message;
        const message = rawMessage === undefined ? undefined : classifyRemoteError(rawMessage);
        resolve({
          ok: f.ok,
          ...(f.result === undefined ? {} : { result: f.result }),
          ...(message === undefined ? {} : { error: message })
        });
        return;
      }
      case "revoked":
        log("session revoked");
        closedReason = "revoked";
        for (const [, resolvePending] of pending) {
          resolvePending({ ok: false, error: "revoked-or-expired: session revoked by host" });
        }
        pending.clear();
        ws?.close();
        return;
      case "error":
        log(`host error: ${f.message}`);
        return;
      default:
        return;
    }
  };

  const redeem = async (): Promise<CapabilityGrant> => {
    const res = await fetch(`${httpBase}/remote/${encodeURIComponent(opts.sessionId)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: opts.pairingPassword })
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? "invalid pairing password" : `join failed (${res.status})`);
    }
    const body = (await res.json()) as { grant: CapabilityGrant };
    return body.grant;
  };

  return {
    connect: async () => {
      closedReason = undefined;
      grant = await redeem();
      const url = `${wsBase}/remote/${encodeURIComponent(opts.sessionId)}/ui`;
      ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for host ready")), 15_000);
        ws!.on("open", () => {
          ws!.send(
            JSON.stringify({
              type: "ui.hello",
              sessionId: opts.sessionId,
              grant,
              seq: 0
            })
          );
        });
        ws!.on("message", (data) => {
          let frame: unknown;
          try {
            frame = JSON.parse(data.toString());
          } catch {
            onMessage(data);
            return;
          }
          if (
            frame !== null &&
            typeof frame === "object" &&
            (frame as { type?: string }).type === "ready"
          ) {
            const readyFunctions = (frame as { functions?: readonly FunctionDescriptor[] }).functions;
            if (readyFunctions !== undefined) {
              seenFunctions = readyFunctions;
            }
            clearTimeout(timer);
            resolve();
            return;
          }
          onMessage(data);
        });
        ws!.on("error", () => {
          clearTimeout(timer);
          reject(new Error("leg-B socket error"));
        });
        ws!.on("close", () => {
          const reason =
            closedReason === "revoked"
              ? "revoked-or-expired: session revoked by host"
              : "connection closed";
          for (const [, resolvePending] of pending) {
            resolvePending({ ok: false, error: reason });
          }
          pending.clear();
        });
      });
      log("leg-B connected");
    },

    call: async (target, action, args = {}, id) => {
      if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
        if (closedReason === "revoked") {
          return { ok: false, error: "revoked-or-expired: session revoked by host" };
        }
        if (grantExpired()) {
          return { ok: false, error: "revoked-or-expired: grant expired" };
        }
        return { ok: false, error: "not connected" };
      }
      if (grantExpired()) {
        return { ok: false, error: "revoked-or-expired: grant expired" };
      }
      const callId = randomUUID();
      seq += 1;
      const envelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action,
        ...(id === undefined ? {} : { id }),
        args
      };
      return await new Promise<RemoteCallOutcome>((resolve) => {
        pending.set(callId, resolve);
        ws!.send(
          JSON.stringify({
            type: "call",
            callId,
            seq,
            nonce: randomUUID(),
            target,
            envelope
          })
        );
      });
    },

    boards: () => ({ ...boards }),

    functions: () => [...seenFunctions],

    close: () => {
      ws?.close();
      ws = undefined;
    }
  };
};
