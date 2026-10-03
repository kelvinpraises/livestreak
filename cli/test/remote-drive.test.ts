import { fixtureMandate } from "../../packages/schema/test/helpers/mandate.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDefaultSettings, saveSettings } from "../src/prefs/settings.js";
import {
  generateCounterFrames,
  IngestPumpError,
  readMarketIdFromBoard,
  runRemoteDrive
} from "../src/gateway/remote/driver.js";
import { runRemoteDrive as runRemoteDriveCommand } from "../src/commands/remote.js";
import type { RemoteUiClient } from "../src/gateway/remote/ui-client.js";

import { Effect } from "effect";
import { createInitialBoard, runConfigFromBoard } from "@livestreak/observe";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    connect: vi.fn(async () => {}),
    call: vi.fn(async () => ({ ok: true })),
    boards: vi.fn(() => ({ observe: observeBoardWithMarket("0xmarketdeadbeef") })),
    close: vi.fn()
  }
}));

vi.mock("../src/gateway/remote/ui-client.js", () => ({
  createRemoteUiClient: () => mockClient as unknown as RemoteUiClient
}));

// Family board: the session index names the observation; its market cell carries the id.
const observeBoardWithMarket = (marketId: string) => ({
  cells: {
    "system:config": {
      readonly: {
        observations: { "obs-drive": { title: "t", chain: "eip155:31337", createdAtMs: 1 } }
      }
    },
    "obs:obs-drive:market": {
      readonly: { marketId }
    }
  }
});

const openDoors: Array<() => Promise<void>> = [];

const startDoor = async (script: (ws: WebSocket) => void): Promise<string> => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const { port } = wss.address() as AddressInfo;
  wss.on("connection", (ws: WebSocket) => script(ws));
  openDoors.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
  return `ws://127.0.0.1:${port}`;
};

const stubAnnounce = (watchUrl: string): void => {
  vi.stubGlobal(
    "fetch",
    async (url: unknown) => {
      if (typeof url === "string" && url.includes("/live/direct/")) {
        return { ok: true, json: async () => ({ watchUrl }) } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }
  );
};

const fullProof = (ws: WebSocket): void => {
  ws.send(Buffer.from([0x01, 1, 2, 3, 4]));
  ws.send(Buffer.from([0x02, 5]));
  ws.send(Buffer.from([0x02, 6]));
};

describe("remote drive", () => {
  let settingsPath: string;

  beforeEach(async () => {
    mockClient.connect.mockClear();
    mockClient.call.mockClear();
    mockClient.boards.mockClear();
    mockClient.close.mockClear();
    mockClient.call.mockImplementation(async (_target: string, action: string) => ({
      ok: true,
      ...(action === "createVault" ? { result: { tokenId: "0xvault01" } } : {}),
      ...(action === "mint" ? { result: { tokenId: "7" } } : {})
    }));
    mockClient.boards.mockReturnValue({
      observe: observeBoardWithMarket("0xmarketdeadbeef"),
      options: { snapshot: { account: "0xoperator" } }
    });

    const dir = await mkdtemp(join(tmpdir(), "livestreak-drive-test-"));
    settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings());
  });

  it("observe-only calls configure then register and skips options/steward", async () => {
    const result = await runRemoteDrive({
      mandate: fixtureMandate("0xmarketdeadbeef"), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_observe",
      pairingPassword: "pw",
      settingsPath,
      observeOnly: true,
      log: () => {}
    });

    expect(result.marketId).toBe("0xmarketdeadbeef");
    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(mockClient.call).toHaveBeenCalledTimes(2);
    expect(mockClient.call.mock.calls[0]?.[0]).toBe("observe");
    expect(mockClient.call.mock.calls[0]?.[1]).toBe("configure");
    expect(mockClient.call.mock.calls[1]?.[0]).toBe("observe");
    expect(mockClient.call.mock.calls[1]?.[1]).toBe("register");
    expect(mockClient.call.mock.calls.some((c) => c[0] === "options")).toBe(false);
    expect(mockClient.call.mock.calls.some((c) => c[0] === "steward")).toBe(false);
  });

  it("binds caller-authored terms to the newly discovered market without inventing rules", async () => {
    const mandateForMarket = vi.fn((marketId: string) => fixtureMandate(marketId));
    await runRemoteDrive({ sessionId: "explicit-terms", pairingPassword: "pw", settingsPath, mandateForMarket, operationId: `0x${"aa".repeat(32)}`, log: () => {} });
    expect(mandateForMarket).toHaveBeenCalledWith("0xmarketdeadbeef");
    const args = mockClient.call.mock.calls.find(c => c[1] === "createVault")?.[2];
    expect(args).toMatchObject({ mandate: fixtureMandate("0xmarketdeadbeef"), operationId: `0x${"aa".repeat(32)}` });
  });

  it("rejects explicit terms for a different market before Bookmaker creation", async () => {
    await expect(runRemoteDrive({ sessionId: "wrong-terms", pairingPassword: "pw", settingsPath, mandate: fixtureMandate("other-market"), operationId: `0x${"aa".repeat(32)}`, log: () => {} })).rejects.toThrow("does not belong");
    expect(mockClient.call.mock.calls.some(c => c[1] === "createVault")).toBe(false);
  });

  it("full path runs configure through withdraw", async () => {
    const result = await runRemoteDrive({
      mandate: fixtureMandate("0xmarketdeadbeef"), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_full",
      pairingPassword: "pw",
      settingsPath,
      log: () => {}
    });

    expect(result.marketId).toBe("0xmarketdeadbeef");
    const actions = mockClient.call.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(actions).toEqual([
      "observe:configure",
      "observe:register",
      "bookmaker:configure",
      "bookmaker:createVault",
      "options:configure",
      "options:setApprovalForAll",
      "options:mint",
      "options:fund",
      "steward:configure",
      "steward:resolve",
      "options:withdraw"
    ]);
    // Threaded ids reach the dependent steps.
    const fundArgs = mockClient.call.mock.calls.find((c) => c[1] === "fund")?.[2] as Record<string, unknown>;
    expect(fundArgs).toMatchObject({ tokenId: "7", vaultId: "0xvault01", side: "yes" });
    const resolveArgs = mockClient.call.mock.calls.find((c) => c[1] === "resolve")?.[2] as Record<string, unknown>;
    expect(resolveArgs).toMatchObject({ subjectId: "0xvault01", subjectKind: "vault" });
  });

  it("readMarketIdFromBoard reads market cell readonly", () => {
    expect(readMarketIdFromBoard(observeBoardWithMarket("0xabc"))).toBe("0xabc");
    expect(readMarketIdFromBoard({ cells: {} })).toBeUndefined();
  });

  it("runRemoteDrive command wrapper prints step summary", async () => {
    const output = await runRemoteDriveCommand({
      mandate: fixtureMandate("0xmarketdeadbeef"), operationId: `0x${"aa".repeat(32)}`,
      session: "sess_cmd",
      pairPassword: "pw",
      settingsPath,
      observeOnly: true
    });
    expect(output).toMatch(/remote drive complete/);
    expect(output).toMatch(/marketId=0xmarketdeadbeef/);
    expect(output).toMatch(/observe:configure=ok/);
    expect(output).toMatch(/observe:register=ok/);
  });
});

describe("remote drive watchability gate", () => {
  const LIVE_MARKET = `0x${"ab".repeat(32)}`;
  const GOLIVE_ID = "observe.obs.obs-drive.market.goLive";

  let settingsPath: string;

  beforeEach(async () => {
    mockClient.connect.mockClear();
    mockClient.call.mockClear();
    mockClient.boards.mockClear();
    mockClient.close.mockClear();
    mockClient.call.mockImplementation(async (_target: string, action: string) => ({
      ok: true,
      ...(action === "createVault" ? { result: { tokenId: "0xvault01" } } : {}),
      ...(action === "mint" ? { result: { tokenId: "7" } } : {})
    }));
    mockClient.boards.mockReturnValue({
      observe: observeBoardWithMarket(LIVE_MARKET),
      options: { snapshot: { account: "0xoperator" } }
    });
    const dir = await mkdtemp(join(tmpdir(), "livestreak-drive-gate-test-"));
    settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const close of openDoors.splice(0)) {
      await close();
    }
  });

  const calls = (action: string): Array<readonly unknown[]> =>
    mockClient.call.mock.calls.filter((c) => c[1] === action);

  const stepOrder = (result: { steps: readonly { action: string }[] }): string[] =>
    result.steps.map((s) => s.action);

  it("proves watch bytes before goLive and leaves the producer running through fund", async () => {
    stubAnnounce(await startDoor(fullProof));
    const lines: string[] = [];
    const result = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_gate_ok",
      pairingPassword: "pw",
      settingsPath,
      directVideoPath: "vid.mp4",
      directTimeoutMs: 4000,
      log: (line: string) => {
        lines.push(line);
      },
    });

    expect(result.marketId).toBe(LIVE_MARKET);
    expect(calls("goLive")).toHaveLength(1);
    expect(calls("goLive")[0]?.[3]).toBe(GOLIVE_ID);
    const order = stepOrder(result);
    expect(order.indexOf("directWatch")).toBeLessThan(order.indexOf("goLive"));
    expect(order.indexOf("goLive")).toBeLessThan(order.indexOf("fund"));
    expect(order.indexOf("fund")).toBeLessThan(order.indexOf("directWatchPostFund"));
    expect(calls("stop")).toHaveLength(0);
    expect(calls("fund")).toHaveLength(1);
    expect(lines.some((l) => l.includes("is not stopping the producer"))).toBe(true);
    expect(lines.some((l) => l.includes("last verified"))).toBe(true);
    expect(lines.some((l) => l.includes("retains running producer"))).toBe(false);
    expect(lines.some((l) => l.includes("confirmed still delivering"))).toBe(false);
  });

  it(
    "blocks goLive on insufficient bytes, requests stop and reports registered",
    { timeout: 15000 },
    async () => {
      stubAnnounce(
        await startDoor((ws) => {
          ws.send(Buffer.from([0x01, 1, 2, 3, 4]));
          ws.close();
        })
      );
      const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
        sessionId: "sess_gate_nobytes",
        pairingPassword: "pw",
        settingsPath,
        directVideoPath: "vid.mp4",
        directTimeoutMs: 2500,
        log: () => {}
      }).then(
        () => new Error("unexpected success"),
        (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
      );
      expect(err.message).toMatch(/remains registered \(not live\)/);
      expect(err.message).toMatch(/stop request (accepted|unconfirmed)/);
      expect(err.message).not.toMatch(/stop confirmed/);
      expect(err.message).not.toMatch(/producer stopped/);
      expect(calls("goLive")).toHaveLength(0);
      expect(calls("stop")).toHaveLength(1);
      expect(calls("createVault")).toHaveLength(0);
    }
  );

  it("post-live fund failure keeps media running and carries reconciling state", async () => {
    stubAnnounce(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) => {
      if (action === "fund") {
        return { ok: false, error: "fund failed (no money)" };
      }
      return {
        ok: true,
        ...(action === "createVault" ? { result: { tokenId: "0xvault01" } } : {}),
        ...(action === "mint" ? { result: { tokenId: "7" } } : {})
      };
    });
    const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_gate_fundfail",
      pairingPassword: "pw",
      settingsPath,
      directVideoPath: "vid.mp4",
      directTimeoutMs: 4000,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toContain(LIVE_MARKET);
    expect(err.message).toMatch(/phase=live;/);
    expect(err.message).toMatch(
      /last verified init=4b fragments=2 \(pre-goLive proof\); current delivery unverified/
    );
    expect(err.message).toMatch(/no stop was sent \(flow-06 owns stop\)/);
    expect(err.message).not.toMatch(/mediaRunning=/);
    expect(err.message).not.toMatch(/producer left running/);
    expect(err.message).not.toMatch(/producer not running/);
    expect(err.message).toMatch(/no rollback claimed/);
    expect(err.message).not.toMatch(/rollback occurred/i);
    expect(calls("goLive")).toHaveLength(1);
    expect(calls("stop")).toHaveLength(0);
  });

  it("failed start reports unknown producer state and requests cleanup", async () => {
    stubAnnounce(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) => {
      if (action === "start") {
        return { ok: false, error: "start rejected" };
      }
      return { ok: true };
    });
    const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_gate_startfail",
      pairingPassword: "pw",
      settingsPath,
      directVideoPath: "vid.mp4",
      directTimeoutMs: 4000,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/after start was attempted/);
    expect(err.message).toMatch(/producer state unknown/);
    expect(err.message).toMatch(/requested cleanup stop \((accepted|unconfirmed)\)/);
    expect(err.message).toMatch(/remains registered \(not live\)/);
    expect(err.message).not.toMatch(/producer not started/);
    expect(calls("goLive")).toHaveLength(0);
    expect(calls("stop")).toHaveLength(1);
  });

  it("ambiguous goLive failure stays uncertain with media alive for readback", async () => {
    stubAnnounce(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) => {
      if (action === "goLive") {
        return { ok: false, error: "denied: ambiguous relay write" };
      }
      return { ok: true };
    });
    const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_gate_ambiguous",
      pairingPassword: "pw",
      settingsPath,
      directVideoPath: "vid.mp4",
      directTimeoutMs: 4000,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/goLive uncertain/);
    expect(err.message).toMatch(/chain phase unknown/);
    expect(err.message).toMatch(/media still running for readback/);
    expect(err.message).not.toMatch(/remains registered/);
    expect(err.message).not.toMatch(/stop request/);
    expect(calls("goLive")).toHaveLength(1);
    expect(calls("stop")).toHaveLength(0);
    expect(calls("createVault")).toHaveLength(0);
  });

  it(
    "fragments before init do not satisfy the watch proof",
    { timeout: 15000 },
    async () => {
      stubAnnounce(
        await startDoor((ws) => {
          ws.send(Buffer.from([0x02, 5]));
          ws.send(Buffer.from([0x02, 6]));
          ws.send(Buffer.from([0x01, 1, 2, 3, 4]));
          ws.close();
        })
      );
      const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
        sessionId: "sess_gate_outoforder",
        pairingPassword: "pw",
        settingsPath,
        directVideoPath: "vid.mp4",
        directTimeoutMs: 2500,
        log: () => {}
      }).then(
        () => new Error("unexpected success"),
        (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
      );
      expect(err.message).toMatch(/watch proof failed/);
      expect(err.message).toMatch(/remains registered \(not live\)/);
      expect(calls("goLive")).toHaveLength(0);
      expect(calls("stop")).toHaveLength(1);
    }
  );

  it(
    "media ending after fund fails the re-probe with last verified state",
    { timeout: 20000 },
    async () => {
      let connections = 0;
      stubAnnounce(
        await startDoor((ws) => {
          connections += 1;
          if (connections > 1) {
            ws.close();
            return;
          }
          fullProof(ws);
        })
      );
      const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
        sessionId: "sess_gate_midfund",
        pairingPassword: "pw",
        settingsPath,
        directVideoPath: "vid.mp4",
        directTimeoutMs: 4000,
        log: () => {}
      }).then(
        () => new Error("unexpected success"),
        (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
      );
      expect(err.message).toMatch(/media re-probe failed after fund/);
      expect(err.message).toMatch(/last verified media: init=4b fragments=2 \(pre-goLive proof\)/);
      expect(err.message).toMatch(/chain phase=live/);
      expect(err.message).toMatch(/no rollback claimed/);
      expect(err.message).toMatch(/current delivery unverified/);
      expect(err.message).not.toMatch(/mediaRunning=true/);
      expect(err.message).not.toMatch(/producer left running/);
      expect(calls("goLive")).toHaveLength(1);
      expect(calls("fund")).toHaveLength(1);
      expect(calls("stop")).toHaveLength(0);
    }
  );
});

describe("remote drive ingest leg", () => {
  const LIVE_MARKET = `0x${"cd".repeat(32)}`;
  const FRAME_W = 16;
  const FRAME_H = 16;
  const FRAME_BYTES = FRAME_W * FRAME_H * 4;

  let settingsPath: string;
  let httpServers: Array<() => Promise<void>>;

  beforeEach(async () => {
    mockClient.connect.mockClear();
    mockClient.call.mockClear();
    mockClient.boards.mockClear();
    mockClient.close.mockClear();
    mockClient.call.mockImplementation(async (_target: string, action: string) => ({
      ok: true,
      ...(action === "createVault" ? { result: { tokenId: "0xvault01" } } : {}),
      ...(action === "mint" ? { result: { tokenId: "7" } } : {})
    }));
    mockClient.boards.mockReturnValue({
      observe: observeBoardWithMarket(LIVE_MARKET),
      options: { snapshot: { account: "0xoperator" } }
    });
    httpServers = [];
    const dir = await mkdtemp(join(tmpdir(), "livestreak-drive-ingest-test-"));
    settingsPath = join(dir, "settings.json");
    await saveSettings(settingsPath, buildDefaultSettings());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const close of openDoors.splice(0)) {
      await close();
    }
    for (const close of httpServers) {
      await close();
    }
  });

  const calls = (action: string): Array<readonly unknown[]> =>
    mockClient.call.mock.calls.filter((c) => c[1] === action);

  // Local stand-in for the gateway loopback endpoint: records POST bodies.
  const startIngestStub = async (
    statusFor: (hits: number) => number
  ): Promise<{ port: number; bodies: Buffer[] }> => {
    const bodies: Buffer[] = [];
    let hits = 0;
    const server = createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        hits += 1;
        bodies.push(Buffer.concat(chunks));
        res.writeHead(statusFor(hits), { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    httpServers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return { port, bodies };
  };

  // Announce goes to the stubbed Host; pump POSTs ride the real fetch through.
  const stubAnnounceForwarding = (watchUrl: string): void => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof globalThis.fetch>) => {
      if (typeof args[0] === "string" && args[0].includes("/live/direct/")) {
        return { ok: true, json: async () => ({ watchUrl }) } as unknown as Response;
      }
      return realFetch(...args);
    });
  };

  const ingestArgs = (port: number) => ({
    width: FRAME_W,
    height: FRAME_H,
    fps: 30,
    port,
    path: "/frames",
    frames: generateCounterFrames(FRAME_W, FRAME_H, 400)
  });

  const driveIngest = (session: string, port: number) =>
    runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: session,
      pairingPassword: "pw",
      settingsPath,
      ingest: ingestArgs(port),
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: () => {}
    });

  it("bot-fed drive proves bytes, funds, and returns media-only with no steward", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    const result = await driveIngest("sess_ingest_ok", stub.port);

    expect(result.marketId).toBe(LIVE_MARKET);
    const kinds = calls("captureKind");
    expect(kinds).toHaveLength(1);
    expect(kinds[0]?.[2]).toEqual({ obsId: "obs-drive", kind: "ingest" });
    const capCfg = mockClient.call.mock.calls.find(
      (c) => c[1] === "configure" && typeof c[2] === "object" && (c[2] as Record<string, unknown>).width === FRAME_W
    );
    expect(capCfg?.[2]).toMatchObject({ width: FRAME_W, height: FRAME_H, fps: 30, port: stub.port, path: "/frames" });
    expect(capCfg?.[3]).toBe("observe.obs.obs-drive.capture.configure");
    expect(mockClient.call.mock.calls.findIndex((c) => c[1] === "captureKind")).toBeLessThan(
      mockClient.call.mock.calls.findIndex((c) => c === capCfg)
    );
    const pubKinds = calls("publishKind");
    expect(pubKinds).toHaveLength(1);
    expect(pubKinds[0]?.[2]).toEqual({ obsId: "obs-drive", kind: "direct" });
    expect(mockClient.call.mock.calls.findIndex((c) => c[1] === "publishKind")).toBeLessThan(
      mockClient.call.mock.calls.findIndex((c) => c === capCfg)
    );
    const actions = mockClient.call.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(actions).toContain("observe:goLive");
    expect(actions).toContain("options:fund");
    const order = result.steps.map((s) => s.action);
    expect(order.indexOf("directWatch")).toBeLessThan(order.indexOf("goLive"));
    expect(order.indexOf("goLive")).toBeLessThan(order.indexOf("fund"));
    expect(order.indexOf("fund")).toBeLessThan(order.indexOf("directWatchPostFund"));
    expect(calls("stop")).toHaveLength(0);
    expect(mockClient.call.mock.calls.some((c) => c[0] === "steward")).toBe(false);
    expect(mockClient.call.mock.calls.some((c) => c[1] === "withdraw")).toBe(false);
    expect(stub.bodies.length).toBeGreaterThan(0);
    expect(stub.bodies.every((b) => b.length === FRAME_BYTES)).toBe(true);
    const pump = result.pump;
    expect(pump).toBeDefined();
    if (pump === undefined) {
      throw new Error("media-only result must carry the pump");
    }
    pump.stop();
    await pump.done;
  });

  it("captureKind denial reports registered with no producer start", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) =>
      action === "captureKind" ? { ok: false, error: "denied" } : { ok: true }
    );
    const err = await driveIngest("sess_ingest_kindfail", stub.port).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/captureKind failed/);
    expect(err.message).toMatch(/remains registered \(not live\)/);
    expect(err.message).toMatch(/producer not started/);
    expect(calls("goLive")).toHaveLength(0);
    expect(calls("stop")).toHaveLength(0);
    expect(calls("createVault")).toHaveLength(0);
  });

  it("publishKind denial reports registered with no producer start", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) =>
      action === "publishKind" ? { ok: false, error: "denied" } : { ok: true }
    );
    const err = await driveIngest("sess_ingest_pubkindfail", stub.port).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/publishKind failed/);
    expect(err.message).toMatch(/remains registered \(not live\)/);
    expect(err.message).toMatch(/producer not started/);
    expect(calls("goLive")).toHaveLength(0);
    expect(calls("stop")).toHaveLength(0);
    expect(calls("createVault")).toHaveLength(0);
  });

  it(
    "insufficient viewer bytes blocks ingest goLive and requests stop",
    { timeout: 20000 },
    async () => {
      const stub = await startIngestStub(() => 200);
      stubAnnounceForwarding(
        await startDoor((ws) => {
          ws.send(Buffer.from([0x01, 1, 2, 3, 4]));
          ws.close();
        })
      );
      const err = await driveIngest("sess_ingest_nobytes", stub.port).then(
        () => new Error("unexpected success"),
        (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
      );
      expect(err.message).toMatch(/watch proof failed/);
      expect(err.message).toMatch(/remains registered \(not live\)/);
      expect(err.message).toMatch(/stop request (accepted|unconfirmed)/);
      expect(calls("goLive")).toHaveLength(0);
      expect(calls("stop")).toHaveLength(1);
      expect(stub.bodies.length).toBeGreaterThan(0);
    }
  );

  it("rejected frame POSTs fail pre-live with posted counts", async () => {
    const stub = await startIngestStub(() => 400);
    stubAnnounceForwarding(await startDoor(fullProof));
    const err = await driveIngest("sess_ingest_400", stub.port).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/ingest POST failed \(400\)/);
    expect(err.message).toMatch(/remains registered \(not live\)/);
    expect(calls("goLive")).toHaveLength(0);
    expect(calls("stop")).toHaveLength(1);
  });

  it("queue-full backpressure still reaches a funded proof", async () => {
    const stub = await startIngestStub((hits) => (hits <= 2 ? 429 : 200));
    stubAnnounceForwarding(await startDoor(fullProof));
    const result = await driveIngest("sess_ingest_429", stub.port);
    expect(result.marketId).toBe(LIVE_MARKET);
    expect(calls("fund")).toHaveLength(1);
    expect(calls("stop")).toHaveLength(0);
    expect(stub.bodies.length).toBeGreaterThan(0);
    expect(stub.bodies.every((b) => b.length === FRAME_BYTES)).toBe(true);
  });

  it("mediaOnly without ingest is rejected before any client call", async () => {
    const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_mediaonly_bare",
      pairingPassword: "pw",
      settingsPath,
      mediaOnly: true,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/mediaOnly requires the ingest block/);
    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it("file and ingest producers cannot be combined", async () => {
    const stub = await startIngestStub(() => 200);
    const err = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_both_producers",
      pairingPassword: "pw",
      settingsPath,
      directVideoPath: "vid.mp4",
      ingest: ingestArgs(stub.port),
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    );
    expect(err.message).toMatch(/choose one producer/);
    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it("frames keep flowing after media-only return until the caller stops the pump", { timeout: 20000 }, async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    const result = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_ingest_handover",
      pairingPassword: "pw",
      settingsPath,
      ingest: { ...ingestArgs(stub.port), frames: generateCounterFrames(FRAME_W, FRAME_H, 100000) },
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: () => {}
    });
    expect(result.marketId).toBe(LIVE_MARKET);
    const pump = result.pump;
    expect(pump).toBeDefined();
    if (pump === undefined) {
      throw new Error("media-only result must carry the pump");
    }
    const atReturn = stub.bodies.length;
    expect(atReturn).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(stub.bodies.length).toBeGreaterThan(atReturn);
    expect(pump.exhausted()).toBe(false);
    expect(calls("stop")).toHaveLength(0);
    pump.stop();
    await pump.done;
  });

  it("an exhausted frame supply is reported but still passes on viewer bytes", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    const lines: string[] = [];
    const result = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_ingest_exhausted",
      pairingPassword: "pw",
      settingsPath,
      ingest: { ...ingestArgs(stub.port), frames: generateCounterFrames(FRAME_W, FRAME_H, 3) },
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: (line: string) => {
        lines.push(line);
      }
    });
    expect(result.marketId).toBe(LIVE_MARKET);
    const pumpExhausted = result.pump;
    const deadline = Date.now() + 5000;
    while (pumpExhausted?.exhausted() !== true && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(result.pump?.exhausted()).toBe(true);
    expect(lines.some((l) => l.includes("frame supply exhausted"))).toBe(true);
    result.pump?.stop();
    await result.pump?.done;
  });

  it("a blocked frame iterable cannot stall drive teardown", { timeout: 20000 }, async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    async function* hangingFrames(): AsyncGenerator<Uint8Array> {
      yield* generateCounterFrames(FRAME_W, FRAME_H, 2);
      await new Promise(() => {});
    }
    const result = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_ingest_blocked",
      pairingPassword: "pw",
      settingsPath,
      ingest: { ...ingestArgs(stub.port), frames: hangingFrames() },
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: () => {}
    });
    expect(result.marketId).toBe(LIVE_MARKET);
    const pump = result.pump;
    expect(pump).toBeDefined();
    if (pump === undefined) {
      throw new Error("media-only result must carry the pump");
    }
    const postedDeadline = Date.now() + 5000;
    while (pump.posted() < 2 && Date.now() < postedDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(pump.posted()).toBe(2);
    pump.stop();
    await Promise.race([
      pump.done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("pump teardown hung")), 3000))
    ]);
  });

  it("uncertain ingest goLive hands a live pump to the caller and sends no stop", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) =>
      action === "goLive" ? { ok: false, error: "denied: ambiguous relay write" } : { ok: true }
    );
    const err: unknown = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_ingest_uncertain",
      pairingPassword: "pw",
      settingsPath,
      ingest: ingestArgs(stub.port),
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(IngestPumpError);
    expect((err as Error).message).toMatch(/goLive uncertain/);
    expect((err as Error).message).toMatch(/under your ownership/);
    expect((err as Error).message).not.toMatch(/remains registered/);
    expect(calls("stop")).toHaveLength(0);
    expect(calls("createVault")).toHaveLength(0);
    const pump = (err as IngestPumpError).pump;
    expect(pump.posted()).toBeGreaterThan(0);
    pump.stop();
    await pump.done;
  });

  it("post-live ingest economy failure carries the pump instead of stopping it", async () => {
    const stub = await startIngestStub(() => 200);
    stubAnnounceForwarding(await startDoor(fullProof));
    mockClient.call.mockImplementation(async (_target: string, action: string) => {
      if (action === "fund") {
        return { ok: false, error: "fund failed (no money)" };
      }
      return { ok: true };
    });
    const err: unknown = await runRemoteDrive({
      mandate: fixtureMandate(LIVE_MARKET), operationId: `0x${"aa".repeat(32)}`,
      sessionId: "sess_ingest_fundfail",
      pairingPassword: "pw",
      settingsPath,
      ingest: ingestArgs(stub.port),
      mediaOnly: true,
      directTimeoutMs: 5000,
      log: () => {}
    }).then(
      () => new Error("unexpected success"),
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(IngestPumpError);
    expect((err as Error).message).toMatch(/drive failed/);
    expect((err as Error).message).toMatch(/phase=live/);
    expect((err as Error).message).not.toMatch(/producer left running/);
    expect(calls("stop")).toHaveLength(0);
    const pump = (err as IngestPumpError).pump;
    expect(pump.posted()).toBeGreaterThan(0);
    pump.stop();
    await pump.done;
  });
});

describe("ingest board derivation (real Observe derivation)", () => {
  const OBS = "obs-derivation";
  const MARKET = `0x${"ef".repeat(32)}`;

  // Board shaped exactly as the kind switches + configure produce it (B's
  // withMarket overlay pattern); the capture/sink SELECTION below is real.
  const derivationBoard = (publishKind: "direct" | "live"): Board => {
    const base = createInitialBoard({ runId: "run_derivation", nowMs: 1 });
    return {
      ...base,
      cells: {
        ...base.cells,
        "system:config": {
          ...base.cells["system:config"],
          readonly: {
            ...(base.cells["system:config"]?.readonly ?? {}),
            observations: { [OBS]: { title: "t", chain: "eip155:31337", createdAtMs: 1 } }
          }
        },
        [`obs:${OBS}:market`]: {
          label: "Market",
          catalog: "market",
          status: ["registered", null, 1],
          settings: {},
          readonly: { marketId: MARKET, registrationState: "registered" },
          functions: []
        },
        [`obs:${OBS}:publish`]: {
          label: "Publish",
          catalog: "publish",
          status: ["configured", null, 1],
          settings: { streamId: MARKET, reachability: "lan" },
          readonly: { kind: publishKind },
          functions: []
        },
        [`obs:${OBS}:capture`]: {
          label: "Capture",
          catalog: "capture:ingest",
          status: ["configured", null, 1],
          settings: { source: "ingest", width: 16, height: 16, fps: 30 },
          readonly: { configured: true, sourceType: "stream", sourceMode: "live" },
          functions: []
        }
      }
    };
  };

  it("ingest capture + direct publish derive the ingest driver and direct sink", async () => {
    const derived = await Effect.runPromise(
      runConfigFromBoard({
        runId: "run_derivation",
        board: derivationBoard("direct"),
        hostBaseUrl: "http://127.0.0.1:9"
      })
    );
    expect(derived.capture.driverId).toBe("ingest");
    expect(derived.sink.driverId).toBe("direct");
  });

  it("the same board with live publish derives the live sink (discriminates the R01 bug)", async () => {
    const derived = await Effect.runPromise(
      runConfigFromBoard({
        runId: "run_derivation",
        board: derivationBoard("live"),
        hostBaseUrl: "http://127.0.0.1:9"
      })
    );
    expect(derived.capture.driverId).toBe("ingest");
    expect(derived.sink.driverId).toBe("live");
  });
});
