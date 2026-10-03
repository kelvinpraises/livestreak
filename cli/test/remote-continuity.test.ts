import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { SessionWallet } from "@livestreak/schema";
import { createApp, createHostRouteDeps } from "../../host/src/server.js";
import { defaultHostServerConfig } from "../../host/src/config/host.js";
import { attachRemoteWss } from "../../host/src/infrastructure/ws/server.js";
import { HostWssTransport, type WebSocketLike } from "../../app/src/utils/host-wss-transport.js";
import { SessionRegistry } from "../src/gateway/session/registry.js";
import { createRelay } from "../src/gateway/remote/relay.js";
import { connectGateway, type WssClient } from "../src/gateway/remote/wss-client.js";
import { createConsoleEdges } from "../src/gateway/console/edges.js";
import { buildConsoleRoutes, createMergedDispatch, mergeConsoleDescriptors } from "../src/gateway/console/edge.js";
import { projectConsoleFunctions } from "../src/gateway/console/functions.js";
import { resolveOperator } from "../src/gateway/auth/identity.js";
import { buildDefaultSettings } from "../src/prefs/settings.js";
import { makePasswordVerifier } from "../src/gateway/session/pairing.js";
import { loadSessions, saveSessions } from "../src/gateway/session/store.js";
import { restoreSessionRecord, sessionContextDigest } from "../src/gateway/session/resume.js";
import { flushRuntimePersistence } from "../src/gateway/state/runtime-persistence.js";

const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("continuity proof timed out"); await new Promise(r => setTimeout(r, 10)); }
};
const serialize = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, n) => typeof n === "bigint" ? n.toString() : n));

// Real Host, CLI gateway, package board persistence and browser transport. The fixed
// wallet address avoids RPC wallet derivation; this proof intentionally sends no chain transaction.
describe("Flow08 real role continuity", () => {
  it("recovers two tabs, restores a configured board after gateway restart, rejects takeover, never replays lost calls, and terminates revoked access", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow08-continuity-"));
    const oldState = process.env.LIVESTREAK_STATE_DIR; process.env.LIVESTREAK_STATE_DIR = dir;
    const deps = createHostRouteDeps(defaultHostServerConfig()); const server = createServer(createApp(deps));
    const handle = attachRemoteWss(server, deps); const clients: HostWssTransport[] = []; const gateways: WssClient[] = [];
    const unsubs: (() => void)[] = []; let release: (() => void) | undefined;
    try {
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const settings = buildDefaultSettings(); const { seed } = resolveOperator("flow08-test-password");
      const wallet: SessionWallet = { chain: settings.defaultChain, seed, operatorAddress: `0x${"11".repeat(20)}`, walletInit: { chain: "evm", seedSource: "signature-derived", config: {} } };
      let registry = new SessionRegistry(); let record = registry.mint({ scopes: ["bridge:board:read", "bridge:action:configure"], ttlMs: 60_000, spendCapUSDC: 100n });
      const id = record.sessionId; const runId = `remote-${id}`; const verifier = makePasswordVerifier("pair");
      const storePath = join(dir, "sessions.json"); const context = sessionContextDigest(settings, wallet.operatorAddress);
      await saveSessions(storePath, [{ ...record, spentUSDC: "0", spendCapUSDC: "100", runId, contextDigest: context, passwordVerifier: verifier }]);
      let calls = 0; let hold = false;
      const boot = async (): Promise<WssClient> => {
        const edges = await createConsoleEdges({ settings, sessionWallet: wallet, runId });
        const dispatch = createMergedDispatch(await buildConsoleRoutes(edges), edges);
        const relay = createRelay({ registry, dispatch: async (caller, envelope, target) => {
          calls++; if (hold) await new Promise<void>(r => { release = r; });
          return dispatch(caller, envelope, target);
        } });
        let ack = false;
        const gw = connectGateway({ hostWssUrl: `${base.replace('http', 'ws')}/remote/${id}/gateway`, seed, registry, relay, onAck: () => { ack = true; } });
        gateways.push(gw);
        for (const edge of edges) {
          if (edge.readBoard) gw.sendBoardPatch(id, serialize(await edge.readBoard()), edge.package);
          if (edge.subscribeBoard) unsubs.push(edge.subscribeBoard(board => gw.sendBoardPatch(id, serialize(board), edge.package)));
        }
        gw.register({ record, passwordVerifier: verifier, functions: projectConsoleFunctions(await mergeConsoleDescriptors(edges), record.scopes) });
        await until(() => ack); return gw;
      };
      const first = await boot();
      const statuses: string[] = []; let boards: Record<string, unknown> = {};
      for (let i = 0; i < 2; i++) {
        const t = new HostWssTransport({ hostBaseUrl: base, retryDelaysMs: [20, 40, 80, 160, 320, 640], readyTimeoutMs: 500, webSocketFactory: url => new WebSocket(url) as unknown as WebSocketLike });
        clients.push(t); t.onStatus(s => statuses.push(s)); t.onPatch(b => { boards = b; });
        await t.connect(await t.redeem(id, "pair"));
      }
      const envelope = { scope: "bridge:action" as const, action: "configure", id: "observe.system.config.configure", args: { title: "Flow08 restored observation", chain: settings.defaultChain } };
      expect((await clients[0]!.send(envelope, "observe")).ok).toBe(true);
      await flushRuntimePersistence(); await until(() => JSON.stringify(boards).includes("Flow08 restored observation"));
      // A rejected connection's close event must not detach the legitimate gateway.
      const rival = new WebSocket(`${base.replace('http', 'ws')}/remote/${id}/gateway`);
      await new Promise(r => rival.once('open', r));
      const rivalClosed = new Promise<number>(r => rival.once('close', code => r(code)));
      rival.send(JSON.stringify({ type: 'register', sessionId: id, scopes: record.scopes, ttlMs: 60000, expiresAt: record.expiresAt, passwordVerifier: verifier }));
      expect(await rivalClosed).toBe(4409); expect(deps.remote.store.getLive(id)?.gateway).not.toBeNull();
      // Brief leg-B loss; both tabs reuse signed grants and receive fresh full snapshots.
      for (const ws of handle.wss.clients) if (ws !== undefined) {
        // Drop both UI and gateway connections to prove both reconnecting legs.
        ws.terminate();
      }
      await until(() => statuses.includes('reconnecting'));
      await until(() => clients.every(t => t.status === 'open'));
      expect(calls).toBe(1); expect(JSON.stringify(boards)).toContain("Flow08 restored observation");
      // Gateway process lifetime ends; restore from persisted identity into new registry/edges.
      first.close(); for (const off of unsubs.splice(0)) off();
      await until(() => deps.remote.store.get(id)?.gateway === null);
      const saved = (await loadSessions(storePath))[0]; registry = new SessionRegistry(); record = registry.restore(restoreSessionRecord(saved, context));
      expect(record.sessionId).toBe(id); expect(record.expiresAt).toBe(saved!.expiresAt);
      const second = await boot(); await until(() => clients.every(t => t.status === 'open'));
      await until(() => JSON.stringify(boards).includes("Flow08 restored observation"));
      // A call lands after its caller drops. Recovery does not submit it again.
      hold = true; const lost = clients[0]!.send({ ...envelope, args: { ...envelope.args, title: "Outcome readback" } }, "observe");
      await until(() => release !== undefined);
      for (const ws of handle.wss.clients) ws.terminate();
      expect((await lost).error).toMatch(/Outcome unknown/); release!(); hold = false;
      await until(() => clients.every(t => t.status === 'open'));
      await until(() => JSON.stringify(boards).includes("Outcome readback")); expect(calls).toBe(2);
      second.revoke(id); await until(() => clients.every(t => t.status === 'revoked'));
      expect(deps.remote.store.getLive(id)).toBeUndefined();
    } finally {
      release?.(); for (const t of clients) t.disconnect(); for (const gw of gateways) gw.close(); for (const off of unsubs) off();
      for (const ws of handle.wss.clients) ws.terminate(); handle.close(); await new Promise<void>(r => server.close(() => r()));
      await deps.catalogDb.close(); await flushRuntimePersistence();
      if (oldState === undefined) delete process.env.LIVESTREAK_STATE_DIR; else process.env.LIVESTREAK_STATE_DIR = oldState;
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
