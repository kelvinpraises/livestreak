// Repeatable real-gateway role proof (Flow 01 plumbing, explicitly off-chain).
//
// Requires Node 22: the in-process Host needs the installed better-sqlite3 ABI
// 127 binding. Skipped elsewhere (CI runs 22).
//
// What is real here: the Host app (join/grant/WSS/relay/scope-enforcement), the
// gateway registry + relay + merged dispatch built from REAL console edges with
// real seed, real wallet init and a fixed test address (a live bundler would be
// needed to derive it; only undispatched lanes read it), leg-A registration over
// a real socket, and
// the driver: a separate outside process running the PACKED public client from
// a clean temp consumer. The only stub is the chain: the permitted action is a
// board-only observe configure over localhost settings, so no chain write can
// occur. The stock example and every chain action remain unproved by this file.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeCaller, CallActionEnvelope, CapabilityScope, SessionWallet } from "@livestreak/schema";
import { createApp, createHostRouteDeps } from "../../host/src/server.js";
import { defaultHostServerConfig } from "../../host/src/config/host.js";
import { attachRemoteWss } from "../../host/src/infrastructure/ws/server.js";
import { SessionRegistry } from "../src/gateway/session/registry.js";
import { createRelay, type Relay } from "../src/gateway/remote/relay.js";
import { connectGateway, type WssClient } from "../src/gateway/remote/wss-client.js";
import { createConsoleEdges } from "../src/gateway/console/edges.js";
import { buildConsoleRoutes, createMergedDispatch, mergeConsoleDescriptors } from "../src/gateway/console/edge.js";
import { projectConsoleFunctions } from "../src/gateway/console/functions.js";
import { buildWalletInitFromSettings } from "../src/gateway/auth/session-wallet.js";
import { resolveOperator } from "../src/gateway/auth/identity.js";
import { buildDefaultSettings, saveSettings } from "../src/prefs/settings.js";
import { generatePairingPassword, makePasswordVerifier } from "../src/gateway/session/pairing.js";
import { runRemoteRevoke } from "../src/commands/remote.js";
import { loadSessions, upsertSession } from "../src/gateway/session/store.js";

// The harmless board action under proof: observation add, no chain leg.
const ACTION = "configure";
const ACTION_ID = "observe.system.config.configure";
const PERMIT_SCOPES: readonly CapabilityScope[] = ["bridge:board:read", "bridge:action:configure"];

const serialize = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));

const NODE22 = Number(process.versions.node.split(".")[0] ?? 0) === 22;

describe("remote role proof (real Host + real gateway + packed outside client)", () => {
  if (!NODE22) {
    it.skip("requires Node 22", () => {});
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const fixture = join(here, "fixtures", "remote-controller.mjs");

  let tmp = "";
  let consumer = "";
  let controllerCopy = "";
  let server: Server | undefined;
  let wssHandle: { close: () => void } | undefined;
  let hostBaseUrl = "";
  let wsBase = "";
  let settingsPath = "";
  let seed: Uint8Array = new Uint8Array();
  let defaultChain = "";
  const gateways: WssClient[] = [];
  const boardUnsubs: Array<() => void> = [];
  const registry = new SessionRegistry();
  let dispatchCount = 0;
  let dispatchesCompleted = 0;
  let inFlightDispatches = 0;
  const heldGates = new Set<() => void>();
  const dispatchErrors: string[] = [];
  let gatewayInbound = 0;
  let holdDispatch = false;
  let releaseDispatch: (() => void) | undefined;
  let baseDispatch:
    | ((
        caller: BridgeCaller,
        envelope: CallActionEnvelope,
        target?: string
      ) => Promise<{ readonly txId?: string; readonly tokenId?: string }>)
    | undefined;
  let savedEnv: Record<string, string | undefined> = {};

  const shared: {
    edges: Awaited<ReturnType<typeof createConsoleEdges>>;
    hostDeps?: { catalogDb: { close: () => Promise<void> } };
  } = {} as never;

  const run = (cmd: string, args: string[], cwd: string, timeoutMs = 300000): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} failed: ${String(stderr || stdout || error.message).slice(-2000)}`));
        } else {
          resolve();
        }
      });
    });

  const pollFor = async (what: string, check: () => boolean, timeoutMs = 15000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (check()) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${what}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "role-proof-"));
    for (const key of ["LIVESTREAK_STATE_DIR", "LIVESTREAK_SESSION_STORE", "DATABASE_URL"] as const) {
      savedEnv[key] = process.env[key];
    }
    process.env["LIVESTREAK_STATE_DIR"] = join(tmp, "state");
    process.env["LIVESTREAK_SESSION_STORE"] = join(tmp, "sessions.json");
    process.env["DATABASE_URL"] = ":memory:";
    settingsPath = join(tmp, "settings.json");
    const settings = buildDefaultSettings();
    defaultChain = settings.defaultChain;
    await saveSettings(settingsPath, settings);

    // Real Host, ephemeral port, in-memory DB.
    const deps = createHostRouteDeps({ ...defaultHostServerConfig() });
    shared.hostDeps = deps;
    const app = createApp(deps);
    server = createServer(app);
    wssHandle = attachRemoteWss(server, deps);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    hostBaseUrl = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;

    // Real gateway stack: test seed, real session wallet, real console edges.
    seed = resolveOperator("role-proof-operator-password").seed as Uint8Array;
    // Real seed + real wallet init; fixed test address (a live bundler would be needed
    // to derive it, and only undispatched lanes read it). Mirrors remote-gateway.test.ts.
    const sessionWallet: SessionWallet = {
      chain: settings.defaultChain,
      seed,
      walletInit: buildWalletInitFromSettings(settings, settings.defaultChain),
      operatorAddress: `0x${"22".repeat(20)}` as `0x${string}`
    };
    const edges = await createConsoleEdges({ settings, sessionWallet, runId: `role-proof-${Date.now()}` });
    shared.edges = edges;
    const routes = await buildConsoleRoutes(edges);
    const realDispatch = createMergedDispatch(routes, edges);
    baseDispatch = realDispatch;

    // Clean consumer of the packed artifact, shared by the whole file.
    const packDir = join(tmp, "pack");
    consumer = join(tmp, "consumer");
    await mkdir(packDir, { recursive: true });
    await run("npm", ["pack", "--workspace=@livestreak/cli", `--pack-destination=${packDir}`], repoRoot);
    const tarball = (await readdir(packDir)).find((f) => f.endsWith(".tgz"));
    if (tarball === undefined) {
      throw new Error("pack produced no tarball");
    }
    await mkdir(consumer, { recursive: true });
    await run("npm", ["init", "-y"], consumer);
    await run("npm", ["install", "--no-save", join(packDir, tarball)], consumer);
    // The controller under test is the COPY inside the clean consumer: launched
    // from there, its bare public import can only resolve the installed tarball.
    controllerCopy = join(consumer, "remote-controller.mjs");
    await copyFile(fixture, controllerCopy);
  }, 300000);

  afterAll(async () => {
    for (const unsub of boardUnsubs.splice(0)) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    for (const gw of gateways.splice(0)) {
      try {
        gw.close();
      } catch {
        /* ignore */
      }
    }
    if (shared.hostDeps !== undefined) {
      try {
        await shared.hostDeps.catalogDb.close();
      } catch {
        /* best-effort */
      }
      shared.hostDeps = undefined;
    }
    wssHandle?.close();
    if (server !== undefined) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tmp !== "") {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  // Failure backstop: kill controllers, release every gate and drain work before
  // the next test can reset its counters, even after an assertion fails.
  afterEach(async () => {
    holdDispatch = false;
    for (const release of [...heldGates]) {
      release();
    }
    releaseDispatch = undefined;
    for (const child of [...trackedChildren]) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      await waitExit(child);
    }
    trackedChildren.clear();
    await pollFor("dispatch teardown", () => inFlightDispatches === 0);
  }, 30000);

  const resetCounters = (): void => {
    if (inFlightDispatches !== 0) {
      throw new Error("cannot reset counters with an earlier dispatch still running");
    }
    dispatchCount = 0;
    dispatchesCompleted = 0;
    dispatchErrors.length = 0;
    gatewayInbound = 0;
    holdDispatch = false;
    releaseDispatch = undefined;
  };

  const openSession = async (
    scopes: readonly CapabilityScope[]
  ): Promise<{ sessionId: string; password: string; gw: WssClient }> => {
    const record = registry.mint({ scopes: [...scopes], ttlMs: 600000 });
    const password = generatePairingPassword();
    let ack!: () => void;
    const acked = new Promise<void>((resolve) => {
      ack = resolve;
    });
    const countingRelay: Relay = {
      handleCall: async (frame) => {
        gatewayInbound += 1;
        return createRelay({
          registry,
          dispatchTimeoutMs: 15000,
          dispatch: async (caller, envelope, target) => {
            dispatchCount += 1;
            inFlightDispatches += 1;
            try {
              if (holdDispatch) {
                await new Promise<void>((resolve) => {
                  const release = (): void => {
                    heldGates.delete(release);
                    resolve();
                  };
                  heldGates.add(release);
                  releaseDispatch = release;
                });
              }
              const result = await baseDispatch!(caller, envelope, target);
              dispatchesCompleted += 1;
              return result;
            } catch (error) {
              dispatchErrors.push(error instanceof Error ? error.message : String(error));
              throw error;
            } finally {
              inFlightDispatches -= 1;
            }
          }
        }).handleCall(frame);
      }
    };
    const gw = connectGateway({
      hostWssUrl: `${wsBase}/remote/${record.sessionId}/gateway`,
      seed,
      relay: countingRelay,
      registry,
      onAck: (sid) => {
        if (sid === record.sessionId) {
          ack();
        }
      },
      log: () => {}
    });
    const edges = shared.edges;
    const functions = projectConsoleFunctions(await mergeConsoleDescriptors(edges), record.scopes);
    gw.register({ record, passwordVerifier: makePasswordVerifier(password), functions });
    await Promise.race([
      acked,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no gateway ack")), 10000))
    ]);
    await upsertSession(process.env["LIVESTREAK_SESSION_STORE"]!, {
      sessionId: record.sessionId,
      scopes: [...record.scopes],
      createdAtMs: record.createdAtMs,
      expiresAt: record.expiresAt,
      spentUSDC: "0",
      revoked: false
    });
    for (const edge of edges) {
      if (edge.readBoard !== undefined) {
        try {
          gw.sendBoardPatch(record.sessionId, serialize(await edge.readBoard()), edge.package);
        } catch {
          /* board snapshot best-effort */
        }
      }
      if (edge.subscribeBoard !== undefined) {
        const unsub = edge.subscribeBoard((board) => {
          try {
            gw.sendBoardPatch(record.sessionId, serialize(board), edge.package);
          } catch {
            /* patch best-effort */
          }
        });
        boardUnsubs.push(unsub);
      }
    }
    gateways.push(gw);
    return { sessionId: record.sessionId, password, gw };
  };

  const runController = (
    args: string[],
    timeoutMs = 60000
  ): Promise<{ exit: number; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      execFile(process.execPath, [controllerCopy, ...args], { cwd: consumer, timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exit: 0, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        const err = error as Error & { code?: unknown; signal?: unknown; killed?: unknown };
        const code = typeof err.code === "number" ? err.code : 1;
        const how = `code=${String(err.code)} signal=${String(err.signal)} killed=${String(err.killed)}`;
        resolve({ exit: code, stdout: String(stdout), stderr: `${how} ${String(stderr)}` });
      });
    });

  const assertResolvedInConsumer = async (ready: unknown): Promise<void> => {
    const resolved = (ready as { resolved?: unknown }).resolved;
    if (typeof resolved !== "string") {
      throw new Error("controller did not report its resolved module URL");
    }
    const [actual, consumerReal, packageReal, repoReal] = await Promise.all([
      realpath(fileURLToPath(resolved)),
      realpath(consumer),
      realpath(join(consumer, "node_modules", "@livestreak", "cli")),
      realpath(repoRoot)
    ]);
    if (!packageReal.startsWith(consumerReal + sep) || !actual.startsWith(packageReal + sep)) {
      throw new Error(`controller loaded outside the consumer: ${actual}`);
    }
    if (actual.startsWith(repoReal + sep)) {
      throw new Error(`controller resolved back into the repo: ${actual}`);
    }
  };

  const controllerJson = async (args: string[]): Promise<{ exit: number; ready: unknown; result: unknown }> => {
    const { exit, stdout, stderr } = await runController(args);
    const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (exit !== 0 || lines.length < 2) {
      throw new Error(`controller failed (exit ${exit}): OUT=${stdout.slice(-500)} ERR=${stderr.slice(-800)}`);
    }
    const ready = JSON.parse(lines[0]!) as unknown;
    await assertResolvedInConsumer(ready);
    return { exit, ready, result: JSON.parse(lines[lines.length - 1]!) as unknown };
  };

  const trackedChildren = new Set<ChildProcess>();

  const spawnController = (args: string[]): {
    child: ChildProcess;
    lines: string[];
    ready: Promise<void>;
    stderr: () => string;
  } => {
    const child = spawn(process.execPath, [controllerCopy, ...args], {
      cwd: consumer,
      stdio: ["ignore", "pipe", "pipe"]
    });
    trackedChildren.add(child);
    const lines: string[] = [];
    let errText = "";
    let buffer = "";
    let readySettled = false;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = () => {
        readySettled = true;
        clearTimeout(timer);
        resolve();
      };
      readyReject = (error: Error) => {
        readySettled = true;
        clearTimeout(timer);
        reject(error);
      };
    });
    const timer = setTimeout(() => {
      readyReject(new Error(`controller never ready; exit=${child.exitCode} stderr=${errText.slice(-500)}`));
    }, 30000);
    timer.unref?.();
    child.stderr?.on("data", (chunk: Buffer) => {
      errText += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          lines.push(line);
          if (lines.length === 1) {
            readyResolve();
          }
        }
      }
    });
    child.once("exit", () => {
      trackedChildren.delete(child);
      if (!readySettled && lines.length === 0) {
        readyReject(new Error(`controller exited before READY; code=${child.exitCode} stderr=${errText.slice(-500)}`));
      }
    });
    child.once("error", (error) => {
      if (!readySettled) {
        readyReject(error);
      }
    });
    return { child, lines, ready, stderr: () => errText };
  };

  // Exit may already have fired before we listen (fast child); never await blindly.
  const waitExit = async (child: ChildProcess, timeoutMs = 10000): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onExit = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.removeListener("exit", onExit);
        child.kill("SIGKILL");
        reject(new Error(`controller did not exit within ${timeoutMs}ms; pid=${child.pid}`));
      }, timeoutMs);
      child.once("exit", onExit);
    });
  };

  // Structural readback: the intended observation entry with title AND chain,
  // never a substring of the whole board.
  const findObservation = (boards: unknown, title: string, chain: string): boolean => {
    const cells = (boards as { observe?: { cells?: Record<string, { readonly?: { observations?: Record<string, { title?: unknown; chain?: unknown }> } }> } })?.observe
      ?.cells;
    const observations = cells?.["system:config"]?.readonly?.observations ?? {};
    return Object.values(observations).some((e) => e?.title === title && e?.chain === chain);
  };

  const boardsView = async (host: string, sessionId: string, password: string): Promise<unknown> =>
    (await controllerJson([host, sessionId, password, "boards"])).result;

  // Explicit board refresh + push, mirroring `remote open`: the live subscription
  // is established asynchronously and may miss a fast change; the refresh path
  // carries the real board state either way.
  const pushBoards = async (sessionId: string, gw: WssClient): Promise<void> => {
    for (const edge of shared.edges) {
      if (edge.readBoard === undefined) {
        continue;
      }
      try {
        gw.sendBoardPatch(sessionId, serialize(await edge.readBoard()), edge.package);
      } catch {
        /* snapshot best-effort */
      }
    }
  };

  // Readback without the push-vs-hello race: ensure the Host holds a fresh board,
  // then let ONE connected child poll its own live view (patches pushed after its
  // hello still arrive). Failing iterations re-push and retry until the deadline.
  const waitForTitle = async (
    host: string,
    sessionId: string,
    password: string,
    title: string,
    chain: string,
    gw: WssClient
  ): Promise<void> => {
    const deadline = Date.now() + 60000;
    for (;;) {
      await pushBoards(sessionId, gw);
      const running = spawnController([host, sessionId, password, "wait-boards", title, "12000"]);
      await running.ready;
      await assertResolvedInConsumer(JSON.parse(running.lines[0] ?? "{}"));
      await waitExit(running.child, 20000);
      if (running.child.exitCode !== 0 || running.lines.length < 2) {
        throw new Error(`wait-boards failed; exit=${running.child.exitCode} stderr=${running.stderr().slice(-300)}`);
      }
      const outcome = JSON.parse(running.lines[running.lines.length - 1]!) as {
        found?: boolean;
        boards?: unknown;
      };
      if (outcome.found === true && findObservation(outcome.boards, title, chain)) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`board never showed ${title}`);
      }
    }
  };

  it("permitted board action lands with exactly one dispatch", async () => {
    resetCounters();
    const { sessionId, password, gw } = await openSession(PERMIT_SCOPES);
    const title = `role-proof-permit-${Date.now()}`;
    const { result } = await controllerJson([
      hostBaseUrl,
      sessionId,
      password,
      "call",
      "observe",
      ACTION,
      JSON.stringify({ title, chain: defaultChain }),
      ACTION_ID
    ]);
    const outcome = result as { ok: boolean; result?: { txId?: string; tokenId?: string }; error?: string };
    expect(outcome.ok).toBe(true);
    // The console bridge issues a local op id for board writes; what must be
    // absent is any chain-tx-shaped hash (configure performs no chain call).
    expect(JSON.stringify(outcome.result ?? {})).not.toMatch(/0x[0-9a-f]{64}/);
    expect(dispatchCount).toBe(1);
    expect(dispatchErrors).toEqual([]);
    expect(gatewayInbound).toBe(1);
    const catalog = await boardsView(hostBaseUrl, sessionId, password);
    const fns = (catalog as { functions?: Array<{ scope?: string }> }).functions ?? [];
    expect(fns.some((f) => f.scope === "bridge:action:configure")).toBe(true);
    await waitForTitle(hostBaseUrl, sessionId, password, title, defaultChain, gw);
  }, 120000);

  it("denied action fails at both boundaries without dispatch", async () => {
    resetCounters();
    const { sessionId, password } = await openSession(PERMIT_SCOPES);
    const before = gatewayInbound;
    const { result } = await controllerJson([
      hostBaseUrl,
      sessionId,
      password,
      "call",
      "steward",
      "resolve",
      JSON.stringify({ subjectId: "probe-noop", subjectKind: "vault", vaultId: "probe-noop", outcome: "yes" })
    ]);
    const outcome = result as { ok: boolean; result?: { txId?: string; tokenId?: string }; error?: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.error ?? "").toMatch(/^scope-denied: /);
    expect(outcome.result?.txId).toBeUndefined();
    expect(outcome.result?.tokenId).toBeUndefined();
    // Host boundary: nothing was forwarded to the gateway for this call.
    expect(gatewayInbound).toBe(before);
    // Gateway boundary: the real registry + relay deny without dispatch.
    const direct = await createRelay({
      registry,
      dispatchTimeoutMs: 15000,
      dispatch: async () => {
        dispatchCount += 1000;
        return {};
      }
    }).handleCall({
      type: "call",
      callId: "deny-direct-1",
      sessionId,
      envelope: { scope: "bridge:action", action: "resolve", args: {} }
    });
    expect(direct.ok).toBe(false);
    expect(dispatchCount).toBe(0);
  }, 120000);

  it("revocation ends the grant with a distinct error", async () => {
    resetCounters();
    holdDispatch = true;
    const { sessionId, password, gw } = await openSession(PERMIT_SCOPES);
    const title = `role-proof-revoke-${Date.now()}`;
    const configureSpec = {
      target: "observe",
      action: ACTION,
      args: { title, chain: defaultChain },
      id: ACTION_ID
    };
    const running = spawnController([
      hostBaseUrl,
      sessionId,
      password,
      "calls",
      JSON.stringify([configureSpec, configureSpec])
    ]);
    await running.ready;
    await assertResolvedInConsumer(JSON.parse(running.lines[0] ?? "{}"));
    await pollFor("gated dispatch entry", () => dispatchCount === 1);
    // Operator revoke path: file mark, registry revoke, gateway leg-A revoke.
    expect(await runRemoteRevoke(sessionId)).toMatch(/^revoked /);
    registry.revoke(sessionId);
    gw.revoke(sessionId);
    await pollFor("revoked results", () => {
      if (running.lines.length >= 2) {
        return true;
      }
      if (running.child.exitCode !== null || running.child.signalCode !== null) {
        throw new Error(`controller exited without revoked results; stderr=${running.stderr().slice(-300)}`);
      }
      return false;
    });
    const outcomes = JSON.parse(running.lines[running.lines.length - 1]!) as ReadonlyArray<{ ok: boolean; error?: string }>;
    // Both calls on the ONE revoked client report revocation distinctly.
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(outcome.error ?? "").toMatch(/^revoked-or-expired: /);
    }
    // Only the first call was ever forwarded; the second died inside the client.
    expect(gatewayInbound).toBe(1);
    expect(dispatchCount).toBe(1);
    releaseDispatch?.();
    holdDispatch = false;
    await pollFor("revoked dispatch completion", () => dispatchesCompleted === 1);
    expect(dispatchErrors).toEqual([]);
    running.child.kill("SIGKILL");
    await waitExit(running.child);
    const stored = (await loadSessions(process.env["LIVESTREAK_SESSION_STORE"]!)).find(
      (s) => s.sessionId === sessionId
    );
    expect(stored?.revoked).toBe(true);
    const rejoin = await runController([hostBaseUrl, sessionId, password, "boards"], 30000);
    expect(rejoin.exit).not.toBe(0);
  }, 120000);

  it("interrupted call reconciles without duplication", async () => {
    resetCounters();
    holdDispatch = true;
    const { sessionId, password, gw } = await openSession(PERMIT_SCOPES);
    const title = `role-proof-reconcile-${Date.now()}`;
    const running = spawnController([
      hostBaseUrl,
      sessionId,
      password,
      "call",
      "observe",
      ACTION,
      JSON.stringify({ title, chain: defaultChain }),
      ACTION_ID
    ]);
    await running.ready;
    await assertResolvedInConsumer(JSON.parse(running.lines[0] ?? "{}"));
    await pollFor("gated dispatch entry", () => dispatchCount === 1);
    running.child.kill("SIGKILL");
    await waitExit(running.child);
    // Killed before any result line: no success was ever claimed.
    expect(running.lines.length).toBe(1);
    releaseDispatch?.();
    holdDispatch = false;
    await pollFor("released dispatch completion", () => dispatchesCompleted === 1);
    expect(dispatchErrors).toEqual([]);
    await waitForTitle(hostBaseUrl, sessionId, password, title, defaultChain, gw);
    expect(dispatchCount).toBe(1);
  }, 120000);
});
