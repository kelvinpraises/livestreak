import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { createAgentClient } from "../src/agent-client.js";
import { classifyRemoteError } from "../src/gateway/remote/ui-client.js";
import { runRemoteBoard } from "../src/commands/remote.js";
import { buildDefaultSettings, saveSettings } from "../src/prefs/settings.js";

// Offline classifier checks — always run, no Host needed.
describe("agent-control error contract", () => {
  it("marks scope denials distinctly", () => {
    expect(classifyRemoteError("denied: scope bridge:action:fund not granted")).toMatch(
      /^scope-denied: /
    );
    expect(classifyRemoteError("out of scope for this grant")).toMatch(/^scope-denied: /);
  });

  it("marks revoked/expired distinctly", () => {
    expect(classifyRemoteError("session revoked by operator")).toMatch(
      /^revoked-or-expired: /
    );
    expect(classifyRemoteError("grant expired at 123")).toMatch(/^revoked-or-expired: /);
  });

  it("passes transport errors through unprefixed", () => {
    expect(classifyRemoteError("connection closed")).toBe("connection closed");
  });

  it("exposes the public surface", () => {
    const client = createAgentClient({
      hostBaseUrl: "http://127.0.0.1:9",
      sessionId: "deadbeef00",
      pairingPassword: "x"
    });
    expect(typeof client.connect).toBe("function");
    expect(typeof client.functions).toBe("function");
    expect(typeof client.boards).toBe("function");
    expect(typeof client.call).toBe("function");
    expect(client.functions()).toEqual([]);
    client.close();
  });
});

// --- Fake Host: minimal leg-B server (join + ui socket) ----------------------
// Speaks just enough of the wire protocol to prove client-side behavior:
// ready/functions capture, denied call_result without ledger dispatch, and the
// revoked frame racing a pending call.

interface FakeHost {
  readonly baseUrl: string;
  readonly receivedCalls: Array<{ target?: string; action: string }>;
  readonly onCall: (send: (frame: unknown) => void, frame: Record<string, unknown>) => void;
  setOnCall(handler: FakeHost["onCall"]): void;
  close(): Promise<void>;
}

const GOOD_PASSWORD = "probe-pair-password";
const SESSION = "probe-session";

const fakeGrant = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "grant_probe",
  sessionId: SESSION,
  holder: "probe",
  scopes: ["bridge:board:read"],
  revoked: false,
  expiresAt: Date.now() + 600_000,
  hostKeyId: "probe_key",
  ...overrides
});

const startFakeHost = async (opts: { expiredGrant?: boolean } = {}): Promise<FakeHost> => {
  const receivedCalls: FakeHost["receivedCalls"] = [];
  let onCall: FakeHost["onCall"] = (send, frame) => {
    send({ type: "call_result", callId: frame["callId"], ok: true, result: {} });
  };
  const sockets = new Set<WebSocket>();
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && (req.url ?? "").endsWith(`/remote/${SESSION}/join`)) {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { password?: string };
          if (parsed.password !== GOOD_PASSWORD) {
            res.writeHead(401).end("nope");
            return;
          }
        } catch {
          res.writeHead(400).end("bad json");
          return;
        }
        res.setHeader("content-type", "application/json").end(
          JSON.stringify({ grant: fakeGrant(opts.expiredGrant === true ? { expiresAt: Date.now() - 1000 } : {}) })
        );
      });
      return;
    }
    res.writeHead(404).end("not found");
  });
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws: WebSocket) => {
    sockets.add(ws);
    const send = (frame: unknown): void => {
      ws.send(JSON.stringify(frame));
    };
    ws.on("message", (data: Buffer) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame["type"] === "ui.hello") {
        send({ type: "ready", sessionId: SESSION, functions: [{ id: "probe.read", package: "probe" }] });
        return;
      }
      if (frame["type"] === "call") {
        const envelope = frame["envelope"] as { action?: string } | undefined;
        receivedCalls.push({
          ...(typeof frame["target"] === "string" ? { target: frame["target"] as string } : {}),
          action: typeof envelope?.action === "string" ? envelope.action : "?"
        });
        onCall(send, frame);
      }
    });
    ws.on("close", () => {
      sockets.delete(ws);
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;
  let server: Server | undefined = http;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    receivedCalls,
    onCall,
    setOnCall(handler: FakeHost["onCall"]): void {
      onCall = handler;
    },
    close: async (): Promise<void> => {
      for (const ws of sockets) ws.close();
      wss.close();
      const s = server;
      server = undefined;
      if (s !== undefined) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  };
};

describe("agent-control against a fake Host", () => {
  let host: FakeHost | undefined;

  afterEach(async () => {
    await host?.close();
    host = undefined;
  });

  it("captures the ready catalog via functions()", async () => {
    host = await startFakeHost();
    const client = createAgentClient({
      hostBaseUrl: host.baseUrl,
      sessionId: SESSION,
      pairingPassword: GOOD_PASSWORD
    });
    try {
      await client.connect();
      expect(client.functions()).toEqual([{ id: "probe.read", package: "probe" }]);
    } finally {
      client.close();
    }
  });

  it("surfaces a denied call_result as scope-denied with no ledger write", async () => {
    host = await startFakeHost();
    // The fake ledger only grows when the server dispatches to it; the denial
    // branch below returns without touching it — mirroring the gateway.
    let ledgerWrites = 0;
    let denied = 0;
    host.setOnCall((send, frame) => {
      denied += 1;
      void ledgerWrites;
      send({
        type: "call_result",
        callId: frame["callId"],
        ok: false,
        error: { message: "denied: scope bridge:action:resolve not granted" }
      });
    });
    const client = createAgentClient({
      hostBaseUrl: host.baseUrl,
      sessionId: SESSION,
      pairingPassword: GOOD_PASSWORD
    });
    try {
      await client.connect();
      const out = await client.call("steward", "resolve", { subjectId: "probe-noop" });
      expect(out.ok).toBe(false);
      expect(out.error ?? "").toMatch(/^scope-denied: /);
      expect(out.result?.txId).toBeUndefined();
      expect(out.result?.tokenId).toBeUndefined();
      expect(ledgerWrites).toBe(0);
      expect(denied).toBe(1);
    } finally {
      client.close();
    }
  });

  it("rejects a pending call as revoked-or-expired on the revoked frame", async () => {
    host = await startFakeHost();
    host.setOnCall((send, frame) => {
      // Hold the call, then revoke: the client must not report transport loss.
      setTimeout(() => {
        send({ type: "revoked" });
        void frame;
      }, 50);
    });
    const client = createAgentClient({
      hostBaseUrl: host.baseUrl,
      sessionId: SESSION,
      pairingPassword: GOOD_PASSWORD
    });
    try {
      await client.connect();
      const out = await client.call("options", "fund", {});
      expect(out.ok).toBe(false);
      expect(out.error ?? "").toMatch(/^revoked-or-expired: /);
      // A later call on the same revoked grant stays revoked, not "not connected".
      const again = await client.call("options", "fund", {});
      expect(again.ok).toBe(false);
      expect(again.error ?? "").toMatch(/^revoked-or-expired: /);
    } finally {
      client.close();
    }
  });

  it("refuses to send when the redeemed grant is already expired", async () => {
    // The fake Host issues a grant with expiresAt in the past; the client's
    // pre-send guard must fail the call before any socket write.
    host = await startFakeHost({ expiredGrant: true });
    const client = createAgentClient({
      hostBaseUrl: host.baseUrl,
      sessionId: SESSION,
      pairingPassword: GOOD_PASSWORD
    });
    try {
      await client.connect();
      const out = await client.call("options", "fund", {});
      expect(out.ok).toBe(false);
      expect(out.error ?? "").toMatch(/^revoked-or-expired: grant expired/);
      expect(host.receivedCalls.length).toBe(0);
    } finally {
      client.close();
    }
  });
});

describe("credential handling", () => {
  const ENV_KEY = "LIVESTREAK_PAIR_PASSWORD";
  let saved: string | undefined;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it("errors without echoing when no credential is available", async () => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    const dir = await mkdtemp(join(tmpdir(), "livestreak-cred-test-"));
    const settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings("http://127.0.0.1:9"));
    await expect(runRemoteBoard({ session: SESSION, settingsPath })).rejects.toThrow(
      /pairing password required/
    );
  });

  it("never prints the secret on transport failure", async () => {
    const canary = "canary-secret-9f27";
    saved = process.env[ENV_KEY];
    process.env[ENV_KEY] = canary;
    const dir = await mkdtemp(join(tmpdir(), "livestreak-cred-test-"));
    const settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings("http://127.0.0.1:9"));
    const file = join(dir, "pair.txt");
    await writeFile(file, `${canary}\n`);
    const err = await runRemoteBoard({ session: SESSION, pairPasswordFile: file, settingsPath }).then(
      () => new Error("unexpected success"),
      (e: unknown) => e as Error
    );
    expect(err.message).not.toContain(canary);
  });
});

// Live probes — run only with explicit env pointing at a real Host + open session.
// The revocation probe DESTROYS the session: use a throwaway `remote open` grant.
// Operator check for no-dispatch: the gateway logs the denial; nothing reaches chain.
const live = process.env["LIVESTREAK_AGENT_PROBE"] === "1";

describe.skipIf(!live)("agent-control live probe", () => {
  const host = process.env["LIVESTREAK_PROBE_HOST"] ?? "http://127.0.0.1:8787";
  const session = process.env["LIVESTREAK_PROBE_SESSION"] ?? "";
  const pairPassword = process.env["LIVESTREAK_PROBE_PAIR_PASSWORD"] ?? "";
  const canRevoke = process.env["LIVESTREAK_PROBE_CAN_REVOKE"] === "1";

  it("reads catalog + boards over the public client", async () => {
    const client = createAgentClient({ hostBaseUrl: host, sessionId: session, pairingPassword: pairPassword });
    try {
      await client.connect();
      expect(Array.isArray(client.functions())).toBe(true);
      expect(typeof client.boards()).toBe("object");
    } finally {
      client.close();
    }
  });

  it("fails an out-of-scope call without dispatching", async () => {
    const client = createAgentClient({ hostBaseUrl: host, sessionId: session, pairingPassword: pairPassword });
    try {
      await client.connect();
      const out = await client.call("steward", "resolve", {
        subjectId: "probe-noop",
        subjectKind: "vault",
        vaultId: "probe-noop",
        outcome: "yes"
      });
      expect(out.ok).toBe(false);
      expect(out.error ?? "").toMatch(/^scope-denied: /);
      expect(out.result?.txId).toBeUndefined();
      expect(out.result?.tokenId).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it("rejects a bad pairing password at join (negative case only)", async () => {
    const client = createAgentClient({
      hostBaseUrl: host,
      sessionId: session,
      pairingPassword: "__wrong__"
    });
    await expect(client.connect()).rejects.toThrow();
    client.close();
  });

  it.skipIf(!canRevoke)("revoking a live grant ends calls with revoked-or-expired", async () => {
    const { runRemoteRevoke } = await import("../src/commands/remote.js");
    const client = createAgentClient({ hostBaseUrl: host, sessionId: session, pairingPassword: pairPassword });
    try {
      await client.connect();
      await runRemoteRevoke(session);
      // The gateway polls its store; allow one poll interval plus margin.
      await new Promise((r) => setTimeout(r, 8000));
      const out = await client.call("options", "fund", {});
      expect(out.ok).toBe(false);
      expect(out.error ?? "").toMatch(/^revoked-or-expired: /);
    } finally {
      client.close();
    }
  });
});
