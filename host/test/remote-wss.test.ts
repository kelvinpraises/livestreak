import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import { attachRemoteWss } from "#infrastructure/ws/server.js";
import { makePasswordVerifier } from "#services/remote/index.js";
import type { HostRouteDeps } from "#deps.js";

// End-to-end over REAL sockets: proves the WSS legs share the http.Server, the
// upgrade router dispatches gateway vs ui, and a UI call round-trips through the
// gateway. (Relay authz internals are covered in remote.test.ts.)

const nextJson = (ws: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));

describe("remote WSS transport (real sockets)", () => {
  let server: Server;
  let deps: HostRouteDeps;
  let port: number;
  let handle: ReturnType<typeof attachRemoteWss>;

  beforeEach(async () => {
    deps = createHostRouteDeps({ ...defaultHostServerConfig() });
    server = createServer(createApp(deps));
    handle = attachRemoteWss(server, deps);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("gateway register → UI hello → call relayed → result returned", async () => {
    const sessionId = "wss_sess";
    const base = `ws://127.0.0.1:${port}`;

    // Leg A: gateway registers the session.
    const gw = new WebSocket(`${base}/remote/${sessionId}/gateway`);
    await new Promise((r) => gw.once("open", r));
    gw.send(
      JSON.stringify({
        type: "register",
        sessionId,
        scopes: ["bridge:action:fund"],
        ttlMs: 60_000,
        passwordVerifier: makePasswordVerifier("pw"),
        functions: [
          { name: "fund", label: "Fund", scope: "bridge:action:fund", disabled: false },
          // out-of-scope for this session's grant → must be filtered out server-side.
          { name: "withdraw", label: "Withdraw", scope: "bridge:action:withdraw", disabled: false }
        ]
      })
    );
    const ack = await nextJson(gw);
    expect(ack.type).toBe("ack");

    // Admission: mint a signed grant for the UI.
    const grant = deps.remote.signer.issueGrant({
      sessionId,
      holder: "ui:e2e",
      scopes: ["bridge:action:fund"],
      expiresAt: Date.now() + 60_000
    });

    // Leg B: UI connects, presents the grant, becomes ready.
    const ui = new WebSocket(`${base}/remote/${sessionId}/ui`);
    await new Promise((r) => ui.once("open", r));
    ui.send(JSON.stringify({ type: "ui.hello", sessionId, grant, seq: 0 }));
    const ready = await nextJson(ui);
    expect(ready.type).toBe("ready");
    // The host filters the gateway catalog by THIS grant's scopes: only `fund` survives.
    const readyFns = ready.functions as ReadonlyArray<{ name: string }>;
    expect(readyFns.map((f) => f.name)).toEqual(["fund"]);

    // Gateway answers the relayed call.
    gw.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.type === "call") {
        gw.send(
          JSON.stringify({ type: "call_result", callId: msg.callId, ok: true, result: { txId: "0xabc" } })
        );
      }
    });

    // UI triggers an in-scope action; result round-trips back on the UI callId.
    ui.send(
      JSON.stringify({
        type: "call",
        callId: "ui-1",
        seq: 1,
        nonce: "n1",
        target: "options",
        envelope: { action: "fund", args: { amount: "1" } }
      })
    );
    const result = await nextJson(ui);
    expect(result.type).toBe("call_result");
    expect(result.callId).toBe("ui-1");
    expect(result.ok).toBe(true);
    expect((result.result as { txId: string }).txId).toBe("0xabc");

    gw.close();
    ui.close();
  });

  it("rejects a UI upgrade for an unknown session", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/remote/nope/ui`);
    const err = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(err).toBeInstanceOf(Error);
  });
});
