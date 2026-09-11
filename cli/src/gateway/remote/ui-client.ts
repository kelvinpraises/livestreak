// Leg-B WSS client for headless remote-console automation (agent-5 driver).

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  bridgeActionScope,
  isUiServerFrame,
  type CallActionEnvelope,
  type CapabilityGrant,
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
  call(target: RemoteDriveTarget, action: string, args?: unknown): Promise<RemoteCallOutcome>;
  boards(): Readonly<Record<string, unknown>>;
  close(): void;
}

const toWsBase = (httpBase: string): string => httpBase.replace(/^http/, "ws").replace(/\/$/, "");

const toHttpBase = (url: string): string => url.replace(/^ws/, "http").replace(/\/$/, "");

export const createRemoteUiClient = (opts: RemoteUiClientOptions): RemoteUiClient => {
  const log = opts.log ?? (() => {});
  const httpBase = toHttpBase(opts.hostBaseUrl);
  const wsBase = toWsBase(opts.hostBaseUrl);
  let ws: WebSocket | undefined;
  let grant: CapabilityGrant | undefined;
  let seq = 0;
  const boards: Record<string, unknown> = {};
  const pending = new Map<string, (outcome: RemoteCallOutcome) => void>();

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
      case "call_result": {
        const resolve = pending.get(f.callId);
        if (resolve === undefined) {
          return;
        }
        pending.delete(f.callId);
        const message =
          f.ok === false && f.error?.message !== undefined
            ? enrichRelayErrorMessage(f.error.message)
            : f.error?.message;
        resolve({
          ok: f.ok,
          ...(f.result === undefined ? {} : { result: f.result }),
          ...(message === undefined ? {} : { error: message })
        });
        return;
      }
      case "revoked":
        log("session revoked");
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
          for (const [, resolvePending] of pending) {
            resolvePending({ ok: false, error: "connection closed" });
          }
          pending.clear();
        });
      });
      log("leg-B connected");
    },

    call: async (target, action, args = {}) => {
      if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
        return { ok: false, error: "not connected" };
      }
      const callId = randomUUID();
      seq += 1;
      const envelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action,
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
            envelope: { scope: envelope.scope, action: envelope.action, args: envelope.args }
          })
        );
      });
    },

    boards: () => ({ ...boards }),

    close: () => {
      ws?.close();
      ws = undefined;
    }
  };
};
