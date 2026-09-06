import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { isModuleEnabled } from "../../config/host.js";
import type { HostRouteDeps } from "../../deps.js";
import type { RelayConn } from "../../services/remote/relay.js";

// --- Remote Bridge Console WSS transport (P4) ---
//
// Two encrypted legs share the Express http.Server via `noServer` upgrades:
//   leg A  wss://<host>/remote/:session/gateway   (gateway; authed at `register`)
//   leg B  wss://<host>/remote/:session/ui        (UI; session-authed at hello)
// The host terminates TLS on both; the seed never crosses either leg. Auth at the
// upgrade boundary is coarse (path + live session); the fine-grained checks
// (gateway token, grant signature, scope, replay) are the relay's job per message.

export interface RemoteWssHandle {
  readonly wss: WebSocketServer;
  readonly close: () => void;
}

const REAP_INTERVAL_MS = 15_000;

export const attachRemoteWss = (server: HttpServer, deps: HostRouteDeps): RemoteWssHandle => {
  const { relay, store } = deps.remote;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!isModuleEnabled(deps.config, "remote")) {
      rejectUpgrade(socket, 404, "remote disabled");
      return;
    }
    const route = parseRemotePath(req.url ?? "");
    if (route === null) {
      rejectUpgrade(socket, 404, "not a remote ws path");
      return;
    }
    // Leg B is rejected early if no live session exists; leg A is authed at register.
    if (route.leg === "ui" && store.getLive(route.sessionId) === undefined) {
      rejectUpgrade(socket, 404, "no live session");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (route.leg === "gateway") {
        handleGateway(ws, route.sessionId);
      } else {
        handleUi(ws, route.sessionId);
      }
    });
  };

  const handleGateway = (ws: WebSocket, sessionId: string): void => {
    const conn = toRelayConn(ws);
    let registered = false;
    ws.on("message", (data) => {
      if (!registered) {
        registered = relay.registerGateway(sessionId, conn, data);
        return;
      }
      relay.onGatewayMessage(sessionId, data);
    });
    ws.on("close", () => relay.onGatewayClose(sessionId));
    ws.on("error", () => ws.close());
  };

  const handleUi = (ws: WebSocket, sessionId: string): void => {
    const conn = toRelayConn(ws);
    const connId = randomUUID();
    let helloed = false;
    ws.on("message", (data) => {
      if (!helloed) {
        helloed = relay.onUiHello(sessionId, connId, conn, data);
        return;
      }
      relay.onUiMessage(sessionId, connId, conn, data);
    });
    ws.on("close", () => relay.onUiClose(sessionId, connId));
    ws.on("error", () => ws.close());
  };

  server.on("upgrade", onUpgrade);

  // TTL reaper: expire stale sessions, tell UIs, drop their sockets.
  const reaper = setInterval(() => {
    for (const sessionId of store.reapExpired()) {
      const session = store.get(sessionId);
      if (session === undefined) {
        continue;
      }
      for (const sink of session.uiSinks.values()) {
        sink({ type: "revoked" });
      }
      session.gateway?.({ type: "session_closed", sessionId, reason: "ttl_expired" });
    }
  }, REAP_INTERVAL_MS);
  reaper.unref?.();

  const close = (): void => {
    clearInterval(reaper);
    server.off("upgrade", onUpgrade);
    wss.close();
  };

  return { wss, close };
};

// --- helpers ---

interface RemoteRoute {
  readonly sessionId: string;
  readonly leg: "gateway" | "ui";
}

const parseRemotePath = (url: string): RemoteRoute | null => {
  const pathname = url.split("?")[0] ?? "";
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // ["remote", "<session>", "gateway" | "ui"]
  if (segments.length !== 3 || segments[0] !== "remote") {
    return null;
  }
  const leg = segments[2];
  if (leg !== "gateway" && leg !== "ui") {
    return null;
  }
  return { sessionId: decodeURIComponent(segments[1]!), leg };
};

const toRelayConn = (ws: WebSocket): RelayConn => ({
  send: (frame) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  },
  close: (code, reason) => ws.close(code, reason)
});

const rejectUpgrade = (socket: Duplex, status: number, message: string): void => {
  socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`);
  socket.destroy();
};
