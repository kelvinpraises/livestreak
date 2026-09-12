// WSS client to the host (leg A). Dials the host relay, registers the session, and pumps inbound
// `call` frames through the relay, sending `call_result`/`board_patch` back. Every outbound frame is
// run through the seed-safety guard. Reconnects with capped backoff; on permanent failure the caller
// locks the keystore (never hold an unlocked seed with no supervisor).

import WebSocket from "ws";
import type { FunctionDescriptor } from "@livestreak/schema";
import {
  isHostFrame,
  type GatewayFrame,
  type HostCallFrame,
  type RegisterFrame,
  type RevokeFrame
} from "@livestreak/schema";
import { assertNoSeedInFrame, type Relay } from "./relay.js";
import type { SessionRecord, SessionRegistry } from "../session/registry.js";

export interface WssClientDeps {
  readonly hostWssUrl: string; // e.g. wss://host/control
  readonly seed: Uint8Array; // for the outbound seed-safety guard only
  readonly relay: Relay;
  readonly registry: SessionRegistry;
  readonly authToken?: string; // leg-A gateway auth (host-defined; sent as a header) — OPEN, see reply
  readonly onAck?: (sessionId: string, remoteUrl?: string) => void;
  readonly onSessionClosed?: (sessionId: string, reason: string) => void;
  readonly maxBackoffMs?: number;
  readonly log?: (line: string) => void;
}

export interface RegisterInput {
  readonly record: SessionRecord;
  // scrypt verifier of the pairing password — the host verifies `/join` against it.
  readonly passwordVerifier: string;
  // Gateway-projected, console-normalized function catalog for the UI.
  readonly functions?: readonly FunctionDescriptor[];
}

export interface WssClient {
  register(input: RegisterInput): void;
  revoke(sessionId: string): void;
  send(frame: GatewayFrame): void;
  sendBoardPatch(sessionId: string, board: unknown, target?: string): void;
  sendFunctions(sessionId: string, functions: readonly FunctionDescriptor[]): void;
  close(): void;
  isConnected(): boolean;
}

export const connectGateway = (deps: WssClientDeps): WssClient => {
  const log = deps.log ?? (() => {});
  const maxBackoffMs = deps.maxBackoffMs ?? 30_000;
  let ws: WebSocket | undefined;
  let closing = false;
  let backoffMs = 500;
  // Frames queued while the socket is (re)connecting.
  const pending: GatewayFrame[] = [];

  const safeSend = (frame: GatewayFrame): void => {
    assertNoSeedInFrame(frame, deps.seed); // seed must never leave the gateway
    if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    } else {
      pending.push(frame);
    }
  };

  const flush = (): void => {
    while (pending.length > 0 && ws !== undefined && ws.readyState === WebSocket.OPEN) {
      const frame = pending.shift();
      if (frame !== undefined) {
        ws.send(JSON.stringify(frame));
      }
    }
  };

  const onCall = (frame: HostCallFrame): void => {
    void deps.relay
      .handleCall(frame)
      .then((result) => safeSend(result))
      .catch((error: unknown) => {
        log(`relay error: ${error instanceof Error ? error.message : String(error)}`);
        safeSend({
          type: "call_result",
          callId: frame.callId,
          sessionId: frame.sessionId,
          ok: false,
          error: { message: "internal relay error" }
        });
      });
  };

  const handleMessage = (data: WebSocket.RawData): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      log("dropping non-JSON host frame");
      return;
    }
    if (!isHostFrame(parsed)) {
      log("dropping unknown host frame");
      return;
    }
    switch (parsed.type) {
      case "ack":
        deps.onAck?.(parsed.sessionId, parsed.remoteUrl);
        return;
      case "call":
        onCall(parsed);
        return;
      case "session_closed":
        deps.registry.revoke(parsed.sessionId);
        deps.onSessionClosed?.(parsed.sessionId, parsed.reason);
        return;
    }
  };

  const open = (): void => {
    if (closing) {
      return;
    }
    const headers = deps.authToken === undefined ? undefined : { authorization: `Bearer ${deps.authToken}` };
    ws = new WebSocket(deps.hostWssUrl, headers === undefined ? undefined : { headers });

    ws.on("open", () => {
      backoffMs = 500;
      log("leg-A connected");
      flush();
    });
    ws.on("message", handleMessage);
    ws.on("error", (error) => log(`leg-A error: ${error.message}`));
    ws.on("close", () => {
      if (closing) {
        return;
      }
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      log(`leg-A closed; reconnecting in ${delay}ms`);
      setTimeout(open, delay).unref?.();
    });
  };

  open();

  return {
    register: ({ record, passwordVerifier, functions }) => {
      // The spend cap is gateway-LOCAL (enforced in SessionRegistry.authorize) and is
      // intentionally NOT sent on the wire — the host neither needs nor stores it.
      const frame: RegisterFrame = {
        type: "register",
        sessionId: record.sessionId,
        scopes: record.scopes,
        ttlMs: Math.max(0, record.expiresAt - record.createdAtMs),
        passwordVerifier,
        ...(deps.authToken === undefined ? {} : { gatewayToken: deps.authToken }),
        ...(functions === undefined ? {} : { functions })
      };
      safeSend(frame);
    },
    revoke: (sessionId) => {
      const frame: RevokeFrame = { type: "revoke", sessionId };
      safeSend(frame);
    },
    send: safeSend,
    sendBoardPatch: (sessionId, board, target) => {
      safeSend({
        type: "board_patch",
        sessionId,
        board,
        ...(target === undefined ? {} : { target })
      });
    },
    sendFunctions: (sessionId, functions) => {
      safeSend({ type: "functions", sessionId, functions });
    },
    close: () => {
      closing = true;
      ws?.close();
    },
    isConnected: () => ws !== undefined && ws.readyState === WebSocket.OPEN
  };
};
