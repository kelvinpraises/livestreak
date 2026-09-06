import request from "supertest";
import { describe, expect, it } from "vitest";
import { capabilityGrantSigningBytes, type CapabilityGrant } from "@livestreak/schema";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import {
  createRemoteService,
  makePasswordVerifier,
  type RelayConn
} from "#services/remote/index.js";

// Fake duplex connection that records every frame the relay sends to it.
const fakeConn = () => {
  const frames: Record<string, unknown>[] = [];
  const closes: { code: number; reason?: string }[] = [];
  const conn: RelayConn = {
    send: (frame) => frames.push(frame as Record<string, unknown>),
    close: (code, reason) => closes.push(reason === undefined ? { code } : { code, reason })
  };
  return { conn, frames, closes };
};

const registerSession = (
  service: ReturnType<typeof createRemoteService>,
  sessionId: string,
  scopes: string[],
  password: string
) => {
  const gw = fakeConn();
  const ok = service.relay.registerGateway(sessionId, gw.conn, {
    type: "register",
    sessionId,
    scopes,
    ttlMs: 60_000,
    passwordVerifier: makePasswordVerifier(password)
  });
  return { gw, ok };
};

const newService = () =>
  createRemoteService({
    gatewayToken: null,
    remoteBaseUrl: "http://127.0.0.1:8787",
    grantKeyHex: null,
    grantKeyId: "host_dev_grant"
  });

describe("remote admission — join → host-signed grant", () => {
  it("rejects wrong password (401) and mints a verifiable grant for the right one", async () => {
    const config = { ...defaultHostServerConfig() };
    const deps = createHostRouteDeps(config);
    const sessionId = "sess_admit";
    registerSession(deps.remote, sessionId, ["bridge:action", "bridge:board:read"], "hunter2");

    const app = createApp(deps);

    const wrong = await request(app)
      .post(`/remote/${sessionId}/join`)
      .send({ password: "nope" });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .post(`/remote/${sessionId}/join`)
      .send({ password: "hunter2" });
    expect(right.status).toBe(200);

    const grant = right.body.grant as CapabilityGrant;
    expect(grant.sessionId).toBe(sessionId);
    expect(grant.sig).toBeTypeOf("string");
    expect(grant.expiresAt).toBeLessThanOrEqual(deps.remote.store.get(sessionId)!.expiresAt);
    expect(right.body.wsPath).toBe(`/remote/${sessionId}/ui`);

    // The signature verifies against the advertised raw Ed25519 public key.
    const { sig, ...unsigned } = grant;
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(deps.remote.signer.publicKeyHex, "hex")
    ]);
    const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
    const verified = edVerify(
      null,
      Buffer.from(capabilityGrantSigningBytes(unsigned)),
      pub,
      Buffer.from(sig!, "hex")
    );
    expect(verified).toBe(true);
  });

  it("404 before the gateway registers; 410 after revoke", async () => {
    const config = { ...defaultHostServerConfig() };
    const deps = createHostRouteDeps(config);
    const app = createApp(deps);

    const unknown = await request(app).post(`/remote/ghost/join`).send({ password: "x" });
    expect(unknown.status).toBe(404);

    const sessionId = "sess_revoke";
    registerSession(deps.remote, sessionId, ["bridge:action"], "pw");
    deps.remote.store.revoke(sessionId);
    const gone = await request(app).post(`/remote/${sessionId}/join`).send({ password: "pw" });
    expect(gone.status).toBe(410);
  });
});

describe("remote relay — scope enforcement, replay, isolation", () => {
  const helloUi = (
    service: ReturnType<typeof createRemoteService>,
    sessionId: string,
    connId: string
  ) => {
    const grant = service.signer.issueGrant({
      sessionId,
      holder: "ui:test",
      scopes: ["bridge:board:read"], // read-only: NO bridge:action
      expiresAt: Date.now() + 60_000
    });
    const ui = fakeConn();
    const ok = service.relay.onUiHello(sessionId, connId, ui.conn, {
      type: "ui.hello",
      sessionId,
      grant,
      seq: 0
    });
    return { ui, grant, ok };
  };

  it("denies an out-of-scope action and never forwards it to the gateway", () => {
    const service = newService();
    const sessionId = "sess_scope";
    const { gw } = registerSession(service, sessionId, ["bridge:board:read"], "pw");
    const { ui, ok } = helloUi(service, sessionId, "conn1");
    expect(ok).toBe(true);

    service.relay.onUiMessage(sessionId, "conn1", ui.conn, {
      type: "call",
      callId: "u1",
      seq: 1,
      nonce: "n1",
      target: "options",
      envelope: { action: "fund", args: {} }
    });

    const result = ui.frames.find((f) => f.type === "call_result");
    expect(result?.ok).toBe(false);
    // The gateway stub received register + ack only — NO `call` was forwarded.
    expect(gw.frames.some((f) => f.type === "call")).toBe(false);
  });

  it("forwards an in-scope action to the gateway and drops a replayed envelope", () => {
    const service = newService();
    const sessionId = "sess_ok";
    const { gw } = registerSession(service, sessionId, ["bridge:action:fund"], "pw");

    const grant = service.signer.issueGrant({
      sessionId,
      holder: "ui:test",
      scopes: ["bridge:action:fund"],
      expiresAt: Date.now() + 60_000
    });
    const ui = fakeConn();
    service.relay.onUiHello(sessionId, "c", ui.conn, {
      type: "ui.hello",
      sessionId,
      grant,
      seq: 0
    });

    const call = {
      type: "call",
      callId: "u1",
      seq: 1,
      nonce: "n1",
      target: "options",
      envelope: { action: "fund", args: { amount: "1" } }
    };
    service.relay.onUiMessage(sessionId, "c", ui.conn, call);
    expect(gw.frames.filter((f) => f.type === "call")).toHaveLength(1);

    // Replay: identical seq/nonce is rejected, not forwarded again.
    service.relay.onUiMessage(sessionId, "c", ui.conn, call);
    expect(gw.frames.filter((f) => f.type === "call")).toHaveLength(1);
    const replayResult = ui.frames.filter((f) => f.type === "call_result").pop();
    expect(replayResult?.ok).toBe(false);
  });

  it("a grant minted for session X cannot drive session Y", () => {
    const service = newService();
    registerSession(service, "X", ["bridge:action"], "pw");
    registerSession(service, "Y", ["bridge:action"], "pw");

    const grantForX = service.signer.issueGrant({
      sessionId: "X",
      holder: "ui:x",
      scopes: ["bridge:action"],
      expiresAt: Date.now() + 60_000
    });
    const ui = fakeConn();
    const ok = service.relay.onUiHello("Y", "c", ui.conn, {
      type: "ui.hello",
      sessionId: "Y",
      grant: grantForX,
      seq: 0
    });
    expect(ok).toBe(false);
    expect(ui.closes.some((c) => c.code === 4403)).toBe(true);
  });

  it("rejects a tampered grant (signature does not verify)", () => {
    const service = newService();
    registerSession(service, "T", ["bridge:action"], "pw");
    const grant = service.signer.issueGrant({
      sessionId: "T",
      holder: "ui:t",
      scopes: ["bridge:board:read"],
      expiresAt: Date.now() + 60_000
    });
    const tampered = { ...grant, scopes: ["bridge:action"] as string[] };
    const ui = fakeConn();
    const ok = service.relay.onUiHello("T", "c", ui.conn, {
      type: "ui.hello",
      sessionId: "T",
      grant: tampered,
      seq: 0
    });
    expect(ok).toBe(false);
  });
});

describe("remote — grant key is independent of the paymaster signer", () => {
  it("uses a dedicated Ed25519 grant key (32-byte pubkey), never an EVM executor key", () => {
    const deps = createHostRouteDeps({ ...defaultHostServerConfig() });
    // Ed25519 raw public key is 32 bytes = 64 hex chars (NOT a secp256k1 EVM key).
    expect(deps.remote.signer.publicKeyHex).toMatch(/^[0-9a-f]{64}$/u);
    expect(deps.remote.signer.keyId).toBe("host_dev_grant");

    // Two independently-created signers (no seed) produce DIFFERENT keys: the key
    // is generated for grants alone and is not shared with any other subsystem.
    const a = newService();
    const b = newService();
    expect(a.signer.publicKeyHex).not.toBe(b.signer.publicKeyHex);
  });
});
