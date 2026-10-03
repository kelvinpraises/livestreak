import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import type { SessionWallet } from "@livestreak/schema";
import { createApp, createHostRouteDeps } from "../../host/src/server.js";
import { defaultHostServerConfig } from "../../host/src/config/host.js";
import { attachRemoteWss } from "../../host/src/infrastructure/ws/server.js";
import { HostWssTransport, type WebSocketLike } from "../../app/src/utils/host-wss-transport.js";
import { runRemoteOpen } from "../src/commands/remote.js";
import { buildDefaultSettings, saveSettings } from "../src/prefs/settings.js";
import { loadSessions } from "../src/gateway/session/store.js";

// Wallet-address derivation would require RPC. All session/keystore/console/Host
// lifecycle code below is real; no chain write is attempted.
vi.mock("../src/gateway/auth/session-wallet.js", () => ({
  buildSessionWallet: async (settings: { defaultChain: string }, seed: Uint8Array): Promise<SessionWallet> => ({
    chain: settings.defaultChain, seed, operatorAddress: `0x${"11".repeat(20)}`,
    walletInit: { chain: "evm", seedSource: "signature-derived", config: {} },
  }),
}));
const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("remote open proof timed out"); await new Promise(r => setTimeout(r, 10)); }
};

describe("remote open explicit resume lifecycle", () => {
  it("preserves the URL, permissions and configured Bookmaker lens across actual open/shutdown/resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flow08-open-"));
    const keys = ['LIVESTREAK_STATE_DIR', 'LIVESTREAK_SESSION_STORE', 'LIVESTREAK_KEYSTORE_PATH'] as const;
    const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    process.env.LIVESTREAK_STATE_DIR = join(dir, 'state'); process.env.LIVESTREAK_SESSION_STORE = join(dir, 'sessions.json'); process.env.LIVESTREAK_KEYSTORE_PATH = join(dir, 'keystore.json');
    const deps = createHostRouteDeps(defaultHostServerConfig()); const server = createServer(createApp(deps)); const handle = attachRemoteWss(server, deps);
    const clients: HostWssTransport[] = []; let current: Promise<string> | undefined;
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const defaults = buildDefaultSettings(); const settingsPath = join(dir, 'settings.json');
      await saveSettings(settingsPath, { ...defaults, host: { ...defaults.host, url: base } });
      current = runRemoteOpen({ settingsPath, password: 'flow08-operator-test', scopes: 'bridge:action:configure,bridge:board:read', ttl: '2m', pairPassword: 'pair', resumable: true, appOrigin: 'https://console.example.test' });
      await until(() => deps.remote.store.all().length === 1);
      const id = deps.remote.store.all()[0]!.sessionId;
      const connect = async () => {
        const t = new HostWssTransport({ hostBaseUrl: base, retryDelaysMs: [20, 40, 80, 160, 320, 640], readyTimeoutMs: 500, webSocketFactory: url => new WebSocket(url) as unknown as WebSocketLike });
        clients.push(t); await t.connect(await t.redeem(id, 'pair')); return t;
      };
      const t = await connect();
      expect((await t.send({ scope: 'bridge:action', action: 'configure', args: { marketId: 'flow08-market' } }, 'bookmaker')).ok).toBe(true);
      process.emit('SIGINT'); await current; current = undefined;
      const saved = (await loadSessions(join(dir, 'sessions.json')))[0]!;
      expect(saved.revoked).toBe(false); expect(saved.configurations?.bookmaker).toEqual({ marketId: 'flow08-market' });
      current = runRemoteOpen({ settingsPath, password: 'flow08-operator-test', resume: id, scopes: 'bridge:action:withdraw', ttl: '99h' });
      await until(() => deps.remote.store.get(id)?.gateway !== null);
      await until(() => t.status === 'open');
      let board = ''; t.onPatch(b => { board = JSON.stringify(b); });
      await until(() => board.includes('flow08-market'));
      const after = (await loadSessions(join(dir, 'sessions.json')))[0]!;
      expect(after.sessionId).toBe(saved.sessionId); expect(after.runId).toBe(saved.runId);
      expect(after.consoleOrigin).toBe(saved.consoleOrigin);
      expect(after.expiresAt).toBe(saved.expiresAt); expect(after.scopes).toEqual(saved.scopes);
      expect(deps.remote.store.all()).toHaveLength(1);
      process.emit('SIGINT'); await current; current = undefined;
      expect((await loadSessions(join(dir, 'sessions.json')))[0]?.revoked).toBe(false);
      current = runRemoteOpen({ settingsPath, password: 'flow08-operator-test', resume: id, scopes: 'bridge:board:read', ttl: '2m' });
      await until(() => deps.remote.store.get(id)?.gateway !== null);
      await until(() => t.status === 'open');
      await writeFile(join(dir, 'sessions.json'), '{corrupt');
      await until(() => t.status === 'revoked');
      await current; current = undefined;
      expect(deps.remote.store.getLive(id)).toBeUndefined();
    } finally {
      if (current) { process.emit('SIGINT'); await current; }
      quiet.mockRestore(); for (const t of clients) t.disconnect(); for (const ws of handle.wss.clients) ws.terminate();
      handle.close(); await new Promise<void>(r => server.close(() => r())); await deps.catalogDb.close();
      for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
