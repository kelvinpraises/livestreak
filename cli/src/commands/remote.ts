import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { readFile } from "node:fs/promises";
import type { BridgeCaller, CallActionEnvelope } from "@livestreak/schema";
import { flushRuntimePersistence } from "../gateway/state/runtime-persistence.js";
import { createConsoleEdges } from "../gateway/console/edges.js";
import {
  buildConsoleRoutes,
  createMergedDispatch,
  mergeConsoleDescriptors,
  type ConsoleEdge,
} from "../gateway/console/edge.js";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import { resolvePassword } from "../gateway/auth/password.js";
import { resolveOperator } from "../gateway/auth/identity.js";
import { defaultKeystorePath, ensureAndUnlock } from "../gateway/auth/keystore.js";
import { createRelay } from "../gateway/remote/relay.js";
import { SessionRegistry, parseScopes, parseTtlMs } from "../gateway/session/registry.js";
import {
  generatePairingPassword,
  makePasswordVerifier,
} from "../gateway/session/pairing.js";
import { projectConsoleFunctions } from "../gateway/console/functions.js";
import { buildSessionWallet } from "../gateway/auth/session-wallet.js";
import {
  acquireSessionLock,
  activeSessions,
  defaultSessionStorePath,
  loadSessions,
  markRevoked,
  upsertSession,
  type StoredSession,
} from "../gateway/session/store.js";
import { restoreSessionRecord, sessionContextDigest } from "../gateway/session/resume.js";
import { connectGateway } from "../gateway/remote/wss-client.js";
import { runRemoteDrive as executeRemoteDrive } from "../gateway/remote/driver.js";
import {
  createRemoteUiClient,
  type RemoteDriveTarget,
} from "../gateway/remote/ui-client.js";
import { ensureSettings, defaultSettingsPath } from "../prefs/settings.js";
import { passwordOpt } from "./args.js";

// LIVESTREAK_HOST_WSS is an OPERATOR-set CLI override for the host WebSocket base (e.g. when the WSS
// endpoint is fronted separately from the HTTP host). Nothing sets it for you — the operator running
// `livestreak remote …` exports it if the default (derive ws(s):// from the HTTP host URL) is wrong.
// It is CLI-side, not a host runtime var, so it is intentionally absent from deploy-host.yml.
const deriveHostWss = (hostUrl: string, sessionId: string, override?: string): string => {
  const base =
    override ??
    process.env["LIVESTREAK_HOST_WSS"] ??
    `${hostUrl.replace(/^http/, "ws").replace(/\/$/, "")}`;
  if (/\/remote\/[^/]+\/gateway\/?$/.test(base)) {
    return base;
  }
  return `${base.replace(/\/$/, "")}/remote/${encodeURIComponent(sessionId)}/gateway`;
};

const resolveAppOrigin = (override?: string): string =>
  (override ?? process.env["LIVESTREAK_APP_ORIGIN"] ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

const appRemoteUrl = (origin: string, sessionId: string): string =>
  `${origin}/remote/${encodeURIComponent(sessionId)}`;

const serializeRemoteBoard = (board: unknown): unknown =>
  JSON.parse(
    JSON.stringify(board, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

export const runRemoteOpen = async (input: {
  readonly resume?: string;
  readonly resumable?: boolean;
  readonly settingsPath?: string;
  readonly password?: string;
  readonly scopes: string;
  readonly ttl: string;
  readonly spendCap?: string;
  readonly hostWss?: string;
  readonly pairPassword?: string;
  readonly appOrigin?: string;
}): Promise<string> => {
  let appOrigin = resolveAppOrigin(input.appOrigin);
  const scopes = parseScopes(input.scopes);
  const ttlMs = parseTtlMs(input.ttl);
  const spendCapUSDC = input.spendCap === undefined ? undefined : BigInt(input.spendCap);
  if (!Number.isSafeInteger(Date.now() + ttlMs) || ttlMs <= 0) throw new Error("TTL must be a finite positive duration");
  if (spendCapUSDC !== undefined && spendCapUSDC < 0n) throw new Error("Spend cap must be nonnegative");

  const pairingPassword = input.pairPassword ?? generatePairingPassword();
  let passwordVerifier = makePasswordVerifier(pairingPassword);

  const settingsPath = input.settingsPath ?? defaultSettingsPath();
  const settings = await ensureSettings(settingsPath);
  const password = await resolvePassword(input.password);
  const { seed } = resolveOperator(password);
  const sessionWallet = await buildSessionWallet(settings, seed);

  const keystorePath = defaultKeystorePath();
  const unlocked = await ensureAndUnlock(keystorePath, seed, password);

  const storePath = defaultSessionStorePath();
  const registry = new SessionRegistry();
  const contextDigest = sessionContextDigest(settings, sessionWallet.operatorAddress);
  const saved = input.resume === undefined ? undefined : (await loadSessions(storePath)).find(s => s.sessionId === input.resume);
  if (input.resume !== undefined && typeof saved?.consoleOrigin === "string") appOrigin = saved.consoleOrigin;
  const record = input.resume === undefined ? registry.mint({
    scopes,
    ttlMs,
    ...(spendCapUSDC === undefined ? {} : { spendCapUSDC }),
  }) : registry.restore(restoreSessionRecord(saved, contextDigest));
  if (input.resume !== undefined) passwordVerifier = saved!.passwordVerifier!;
  const configurations = { ...(saved?.configurations ?? {}) };
  const resumable = input.resumable === true || input.resume !== undefined;
  const releaseLock = await acquireSessionLock(storePath, record.sessionId);
  try {
    const persist = async (remoteUrl?: string): Promise<void> => {
      const stored: StoredSession = {
        sessionId: record.sessionId,
        holder: record.holder,
        runId: `remote-${record.sessionId}`,
        passwordVerifier,
        contextDigest,
        consoleOrigin: appOrigin,
        configurations: { ...configurations },
        scopes: record.scopes,
        createdAtMs: record.createdAtMs,
        expiresAt: record.expiresAt,
        ...(record.spendCapUSDC === undefined ? {} : { spendCapUSDC: record.spendCapUSDC.toString() }),
        spentUSDC: record.spentUSDC.toString(),
        revoked: record.revoked,
        ...(remoteUrl === undefined ? {} : { remoteUrl }),
      };
      await upsertSession(storePath, stored);
    };
    await persist();

    const runId = `remote-${record.sessionId}`;
    const consoleEdges: ConsoleEdge[] = await createConsoleEdges({
      settings,
      sessionWallet,
      runId,
    });

    const log = (line: string): void => {
      console.error(`[gateway] ${line}`);
    };

    const routes = await buildConsoleRoutes(consoleEdges);
    const dispatch = createMergedDispatch(routes, consoleEdges);

    // Restore only validated local lens selection, never a transaction or active media process.
    for (const [target, args] of Object.entries(configurations)) {
      if (!["options", "bookmaker", "steward"].includes(target) || !args ||
          Object.entries(args).some(([key, value]) => !["marketId", "vaultId"].includes(key) || typeof value !== "string")) {
        throw new Error("Invalid saved console configuration; refusing resume");
      }
      await dispatch(localOperatorCaller(), { scope: "bridge:action", action: "configure", args }, target);
    }

    let consoleFunctions: readonly import("@livestreak/schema").FunctionDescriptor[] = [];
    try {
      const raw = await mergeConsoleDescriptors(consoleEdges);
      consoleFunctions = projectConsoleFunctions(raw, record.scopes);
      log(`function catalog: ${raw.length} total, ${consoleFunctions.length} in scope`);
    } catch (error) {
      log(
        `function projection skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const relay = createRelay({
      registry,
      beforeDispatch: async () => {
        const latest = (await loadSessions(storePath)).find(s => s.sessionId === record.sessionId);
        if (!latest || latest.revoked) { registry.revoke(record.sessionId); throw new Error(latest ? "session revoked" : "session metadata unavailable; start a fresh session"); }
        await persist(record.remoteUrl);
      },
      dispatch: async (caller: BridgeCaller, envelope: CallActionEnvelope, target?: string) => {
        const result = await dispatch(caller, envelope, target);
        if (target && ["options", "bookmaker", "steward"].includes(target)) {
          if (envelope.action === "configure") {
            const args = envelope.args as { marketId?: string; vaultId?: string };
            configurations[target] = {
              ...(typeof args.marketId === "string" ? { marketId: args.marketId } : {}),
              ...(typeof args.vaultId === "string" ? { vaultId: args.vaultId } : {}),
            };
            await persist(record.remoteUrl);
          } else if (envelope.action === "close") {
            delete configurations[target];
            await persist(record.remoteUrl);
          }
        }
        return result;
      },
    });
    const hostWss = deriveHostWss(settings.host.url, record.sessionId, input.hostWss);
    const boardUnsubs: Array<() => void> = [];
    const pushBoard = (target: string, board: unknown): void => {
      try {
        wss.sendBoardPatch(record.sessionId, serializeRemoteBoard(board), target);
      } catch (error) {
        log(`board patch skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const wss = connectGateway({
      hostWssUrl: hostWss,
      seed: unlocked.seed,
      relay,
      registry,
      ...(process.env["LIVESTREAK_GATEWAY_TOKEN"] === undefined
        ? {}
        : { authToken: process.env["LIVESTREAK_GATEWAY_TOKEN"] }),
      onAck: (sessionId, remoteUrl) => {
        if (sessionId === record.sessionId && remoteUrl !== undefined) {
          record.remoteUrl = remoteUrl;
          void persist(remoteUrl).catch(error => log(`session persistence failed: ${String(error)}`));
          console.log(input.resume === undefined ? "New session registered." : "Resumed the same session URL and run ID.");
          console.log(`remote console URL: ${appRemoteUrl(appOrigin, record.sessionId)}`);
        }
      },
      log,
    });
    // Board-first reveal: a board change can newly reveal (or hide) actions, so re-project the catalog
    // and re-push it. Without this the UI's function panel freezes at the open-time projection and
    // board-gated actions (observe register, options fund, …) never appear as buttons after configure.
    const refreshFunctions = async (): Promise<void> => {
      try {
        const raw = await mergeConsoleDescriptors(consoleEdges);
        wss.sendFunctions(record.sessionId, projectConsoleFunctions(raw, record.scopes));
      } catch (error) {
        log(
          `functions refresh skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    for (const edge of consoleEdges) {
      if (edge.subscribeBoard === undefined) {
        continue;
      }
      boardUnsubs.push(
        edge.subscribeBoard((board) => {
          pushBoard(edge.package, board);
          void refreshFunctions();
        }),
      );
    }
    void (async () => {
      for (const edge of consoleEdges) {
        try {
          await edge.refresh?.();
        } catch (error) {
          log(
            `${edge.package} board refresh skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (edge.readBoard === undefined) {
          continue;
        }
        try {
          pushBoard(edge.package, await edge.readBoard());
        } catch (error) {
          log(
            `${edge.package} board snapshot skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    })();
    wss.register({
      record,
      passwordVerifier,
      ...(consoleFunctions.length === 0 ? {} : { functions: consoleFunctions }),
    });

    const shutdown = async (reason: string): Promise<void> => {
      for (const unsub of boardUnsubs) {
        unsub();
      }
      if (!resumable || reason === "revoked" || reason === "ttl_expired") {
        registry.revoke(record.sessionId);
        wss.revoke(record.sessionId);
        wss.close();
        await markRevoked(storePath, record.sessionId);
      } else {
        wss.close();
        await persist(record.remoteUrl);
      }
      await flushRuntimePersistence();
      unlocked.lock();
      console.error(`[gateway] session ${record.sessionId} closed (${reason})`);
    };

    return await new Promise<string>((resolve) => {
      let ending = false;
      const finish = async (reason: string): Promise<void> => {
        if (ending) return;
        ending = true;
        clearInterval(timer);
        process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
        try { await shutdown(reason); }
        catch (error) { wss.close(); unlocked.lock(); log(`shutdown persistence failed: ${String(error)}`); }
        resolve(`session ${record.sessionId} ended (${reason})`);
      };
      const timer = setInterval(() => {
        void (async () => {
          const sessions = await loadSessions(storePath);
          const mine = sessions.find((s) => s.sessionId === record.sessionId);
          if (mine === undefined || mine.revoked) {
            registry.revoke(record.sessionId);
          }
          if (record.revoked || Date.now() >= record.expiresAt) {
            clearInterval(timer);
            await finish(record.revoked ? "revoked" : "ttl_expired");
          }
        })().catch(error => { log(`session read failed: ${String(error)}`); void finish("revoked"); });
      }, 1000);
      timer.unref?.();

      const onInt = (): void => { void finish("SIGINT"); };
      const onTerm = (): void => { void finish("SIGTERM"); };
      process.once("SIGINT", onInt);
      process.once("SIGTERM", onTerm);

      const ttlSecs = Math.max(0, Math.round((record.expiresAt - Date.now()) / 1000));
      console.log(
        [
          "livestreak remote open",
          "",
          `pairing code: ${record.sessionId}`,
          input.resume === undefined ? `pairing pass: ${pairingPassword}` : "pairing pass: unchanged (use the original pairing password)",
          `console URL:  ${appRemoteUrl(appOrigin, record.sessionId)}`,
          `scopes:       ${record.scopes.join(", ")}`,
          `expires in:   ${ttlSecs}s`,
          record.spendCapUSDC === undefined
            ? "spend cap:    none"
            : `spend cap:    ${record.spentUSDC}/${record.spendCapUSDC} (atomic USDC, reserved usage)`,
          `host (leg A): ${hostWss}`,
          "",
          input.resume === undefined ? "Created a new session; awaiting Host registration." : "Restoring the original session; awaiting Host confirmation.",
          resumable ? "Ctrl-C disconnects; resume with --resume <session>. Use remote revoke to terminate access." : "Share the pairing code AND pairing pass. Ctrl-C revokes and exits.",
        ].join("\n"),
      );
    });
  } finally { await releaseLock(); unlocked.lock(); }
};

export const runRemoteList = async (): Promise<string> => {
  const storePath = defaultSessionStorePath();
  const sessions = activeSessions(await loadSessions(storePath));
  if (sessions.length === 0) {
    return "no active remote sessions";
  }
  return sessions
    .map((s) => {
      const cap =
        s.spendCapUSDC === undefined ? "none" : `${s.spentUSDC}/${s.spendCapUSDC}`;
      const remaining = Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000));
      return `${s.sessionId}  scopes=[${s.scopes.join(",")}]  expires=${remaining}s  spend=${cap}`;
    })
    .join("\n");
};

export const runRemoteRevoke = async (sessionId: string): Promise<string> => {
  const storePath = defaultSessionStorePath();
  const ok = await markRevoked(storePath, sessionId);
  return ok ? `revoked ${sessionId}` : `no such session ${sessionId}`;
};

export const runRemoteDrive = async (input: {
  readonly session: string;
  readonly pairPassword: string;
  readonly stewardSession?: string;
  readonly stewardPairPassword?: string;
  readonly hostUrl?: string;
  readonly settingsPath?: string;
  readonly marketId?: string;
  readonly observeOnly?: boolean;
  readonly mandate?: import("@livestreak/schema").VaultMandate;
  readonly mandateFile?: string;
  readonly operationId?: string;
  readonly fundDeposit?: string;
  readonly resolveOutcome?: string;
  readonly resolveReason?: string;
  readonly resolveEvidenceJson?: string;
  readonly directVideo?: string;
  readonly directPort?: number;
}): Promise<string> => {
  const mandate =
    input.mandate ??
    (input.mandateFile
      ? (JSON.parse(
          await readFile(input.mandateFile, "utf8"),
        ) as import("@livestreak/schema").VaultMandate)
      : undefined);
  const result = await executeRemoteDrive({
    sessionId: input.session,
    ...(mandate === undefined ? {} : { mandate }),
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    pairingPassword: input.pairPassword,
    ...(input.stewardSession === undefined
      ? {}
      : { stewardSessionId: input.stewardSession }),
    ...(input.stewardPairPassword === undefined
      ? {}
      : { stewardPairingPassword: input.stewardPairPassword }),
    ...(input.hostUrl === undefined ? {} : { hostUrl: input.hostUrl }),
    ...(input.settingsPath === undefined ? {} : { settingsPath: input.settingsPath }),
    ...(input.marketId === undefined ? {} : { marketId: input.marketId }),
    ...(input.observeOnly === undefined ? {} : { observeOnly: input.observeOnly }),
    ...(input.fundDeposit === undefined ? {} : { fundDeposit: input.fundDeposit }),
    ...(input.resolveOutcome === undefined ? {} : { resolveOutcome: input.resolveOutcome }),
    ...(input.resolveReason === undefined ? {} : { resolveReason: input.resolveReason }),
    ...(input.resolveEvidenceJson === undefined
      ? {}
      : { resolveEvidenceJson: input.resolveEvidenceJson }),
    ...(input.directVideo === undefined ? {} : { directVideoPath: input.directVideo }),
    ...(input.directPort === undefined ? {} : { directPort: input.directPort }),
  });
  const summary = result.steps
    .map((s) => `${s.target}:${s.action}=${s.ok ? "ok" : "fail"}`)
    .join(" ");
  return `remote drive complete marketId=${result.marketId ?? "n/a"} ${summary}`;
};

// Pairing-password resolution for consumer commands: explicit flag wins, then file,
// then env. Errors never echo the secret.
export const resolvePairPassword = async (input: {
  readonly pairPassword?: string;
  readonly pairPasswordFile?: string;
}): Promise<string> => {
  if (input.pairPassword !== undefined && input.pairPassword.length > 0) {
    return input.pairPassword;
  }
  if (input.pairPasswordFile !== undefined) {
    try {
      const secret = (await readFile(input.pairPasswordFile, "utf8")).trim();
      if (secret.length > 0) {
        return secret;
      }
    } catch {
      throw new Error(`cannot read --pair-password-file ${input.pairPasswordFile}`);
    }
  }
  const env = process.env["LIVESTREAK_PAIR_PASSWORD"];
  if (env !== undefined && env.length > 0) {
    return env;
  }
  throw new Error(
    "pairing password required (pass --pair-password, --pair-password-file, or LIVESTREAK_PAIR_PASSWORD)",
  );
};

export const runRemoteBoard = async (input: {
  readonly session: string;
  readonly pairPassword?: string;
  readonly pairPasswordFile?: string;
  readonly hostUrl?: string;
  readonly settingsPath?: string;
}): Promise<string> => {
  const settings = await ensureSettings(input.settingsPath ?? defaultSettingsPath());
  const pairingPassword = await resolvePairPassword(input);
  const client = createRemoteUiClient({
    hostBaseUrl: input.hostUrl ?? settings.host.url,
    sessionId: input.session,
    pairingPassword,
  });
  try {
    await client.connect();
    return JSON.stringify(
      { functions: client.functions(), boards: client.boards() },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
  } finally {
    client.close();
  }
};

export const runRemoteCall = async (input: {
  readonly session: string;
  readonly pairPassword?: string;
  readonly pairPasswordFile?: string;
  readonly target: string;
  readonly action: string;
  readonly argsJson?: string;
  readonly id?: string;
  readonly hostUrl?: string;
  readonly settingsPath?: string;
}): Promise<string> => {
  let args: unknown = {};
  if (input.argsJson !== undefined) {
    try {
      args = JSON.parse(input.argsJson) as unknown;
    } catch {
      throw new Error("invalid --args-json (must be JSON)");
    }
  }
  const settings = await ensureSettings(input.settingsPath ?? defaultSettingsPath());
  const pairingPassword = await resolvePairPassword(input);
  const client = createRemoteUiClient({
    hostBaseUrl: input.hostUrl ?? settings.host.url,
    sessionId: input.session,
    pairingPassword,
  });
  try {
    await client.connect();
    const outcome = await client.call(
      input.target as RemoteDriveTarget,
      input.action,
      args,
      input.id,
    );
    if (!outcome.ok) {
      throw new Error(outcome.error ?? "remote call failed");
    }
    return JSON.stringify(outcome.result ?? { ok: true });
  } finally {
    client.close();
  }
};

const scopesOpt = Options.text("scopes").pipe(
  Options.withDescription(
    "Comma-separated granular scopes, e.g. bridge:action:fund,bridge:board:read",
  ),
);
const ttlOpt = Options.text("ttl").pipe(
  Options.withDescription("Session lifetime, e.g. 30m, 1h, 90s"),
);
const spendCapOpt = Options.text("spend-cap").pipe(Options.optional);
const hostWssOpt = Options.text("host-wss").pipe(Options.optional);
const appOriginOpt = Options.text("app-origin").pipe(
  Options.withDescription(
    "App origin for the printed remote console URL (default http://localhost:3000)",
  ),
  Options.optional,
);
const pairPasswordFileOpt = Options.text("pair-password-file").pipe(
  Options.withDescription(
    "File holding the pairing password (preferred over --pair-password)",
  ),
  Options.optional,
);
const pairPasswordOpt = Options.text("pair-password").pipe(
  Options.withDescription(
    "Pairing password shared with the remote user (generated if omitted)",
  ),
  Options.optional,
);
const settingsPathOpt = Options.text("settings").pipe(
  Options.withDescription("Path to settings.json"),
  Options.optional,
);

const remoteOpenCommand = Command.make(
  "open",
  {
    resume: Options.text("resume").pipe(Options.optional),
    resumable: Options.boolean("resumable"),
    scopes: scopesOpt.pipe(Options.withDefault("bridge:board:read")),
    ttl: ttlOpt.pipe(Options.withDefault("30m")),
    spendCap: spendCapOpt,
    hostWss: hostWssOpt,
    pairPassword: pairPasswordOpt,
    appOrigin: appOriginOpt,
    settings: settingsPathOpt,
    password: passwordOpt,
  },
  ({ resume, resumable, scopes, ttl, spendCap, hostWss, pairPassword, appOrigin, settings, password }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteOpen({
          ...(Option.isSome(resume) ? { resume: resume.value } : {}),
          resumable,
          scopes,
          ttl,
          ...(Option.isSome(spendCap) ? { spendCap: spendCap.value } : {}),
          ...(Option.isSome(hostWss) ? { hostWss: hostWss.value } : {}),
          ...(Option.isSome(pairPassword) ? { pairPassword: pairPassword.value } : {}),
          ...(Option.isSome(appOrigin) ? { appOrigin: appOrigin.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
          ...(Option.isSome(password) ? { password: password.value } : {}),
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.flatMap((output) => Console.log(output))),
);

const remoteListCommand = Command.make("list", {}, () =>
  Effect.tryPromise({
    try: () => runRemoteList(),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(Effect.flatMap((output) => Console.log(output))),
);

const remoteRevokeCommand = Command.make(
  "revoke",
  { session: Options.text("session") },
  ({ session }) =>
    Effect.tryPromise({
      try: () => runRemoteRevoke(session),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.flatMap((output) => Console.log(output))),
);

const remoteDriveCommand = Command.make(
  "drive",
  {
    session: Options.text("session"),
    pairPassword: Options.text("pair-password"),
    stewardSession: Options.text("steward-session").pipe(Options.optional),
    stewardPairPassword: Options.text("steward-pair-password").pipe(Options.optional),
    hostUrl: Options.text("host-url").pipe(Options.optional),
    settings: settingsPathOpt,
    marketId: Options.text("market-id").pipe(Options.optional),
    observeOnly: Options.boolean("observe-only").pipe(Options.optional),
    mandateFile: Options.text("mandate-file").pipe(
      Options.withDescription(
        "Explicit livestreak-mandate/1 JSON; bind it to the intended market",
      ),
      Options.optional,
    ),
    operationId: Options.text("operation-id").pipe(Options.optional),
    fundDeposit: Options.text("fund-deposit").pipe(Options.optional),
    resolveOutcome: Options.text("resolve-outcome").pipe(Options.optional),
    resolveReason: Options.text("resolve-reason").pipe(Options.optional),
    resolveEvidenceJson: Options.text("resolve-evidence-json").pipe(Options.optional),
    directVideo: Options.text("direct-video").pipe(
      Options.withDescription(
        "Media file for the direct-serve video leg (publish=direct, lan mode)",
      ),
      Options.optional,
    ),
    directPort: Options.integer("direct-port").pipe(Options.optional),
  },
  ({
    session,
    pairPassword,
    stewardSession,
    stewardPairPassword,
    hostUrl,
    settings,
    marketId,
    observeOnly,
    mandateFile,
    operationId,
    fundDeposit,
    resolveOutcome,
    resolveReason,
    resolveEvidenceJson,
    directVideo,
    directPort,
  }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteDrive({
          session,
          pairPassword,
          ...(Option.isSome(stewardSession)
            ? { stewardSession: stewardSession.value }
            : {}),
          ...(Option.isSome(stewardPairPassword)
            ? { stewardPairPassword: stewardPairPassword.value }
            : {}),
          ...(Option.isSome(hostUrl) ? { hostUrl: hostUrl.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
          ...(Option.isSome(marketId) ? { marketId: marketId.value } : {}),
          ...(Option.isSome(observeOnly) ? { observeOnly: observeOnly.value } : {}),
          ...(Option.isSome(mandateFile) ? { mandateFile: mandateFile.value } : {}),
          ...(Option.isSome(operationId) ? { operationId: operationId.value } : {}),
          ...(Option.isSome(fundDeposit) ? { fundDeposit: fundDeposit.value } : {}),
          ...(Option.isSome(resolveOutcome)
            ? { resolveOutcome: resolveOutcome.value }
            : {}),
          ...(Option.isSome(resolveReason) ? { resolveReason: resolveReason.value } : {}),
          ...(Option.isSome(resolveEvidenceJson)
            ? { resolveEvidenceJson: resolveEvidenceJson.value }
            : {}),
          ...(Option.isSome(directVideo) ? { directVideo: directVideo.value } : {}),
          ...(Option.isSome(directPort) ? { directPort: directPort.value } : {}),
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.flatMap((output) => Console.log(output))),
);

const remoteBoardCommand = Command.make(
  "board",
  {
    session: Options.text("session"),
    pairPassword: Options.text("pair-password").pipe(Options.optional),
    pairPasswordFile: pairPasswordFileOpt,
    hostUrl: Options.text("host-url").pipe(Options.optional),
    settings: settingsPathOpt,
  },
  ({ session, pairPassword, pairPasswordFile, hostUrl, settings }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteBoard({
          session,
          ...(Option.isSome(pairPassword) ? { pairPassword: pairPassword.value } : {}),
          ...(Option.isSome(pairPasswordFile)
            ? { pairPasswordFile: pairPasswordFile.value }
            : {}),
          ...(Option.isSome(hostUrl) ? { hostUrl: hostUrl.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.flatMap((output) => Console.log(output))),
);

const remoteCallCommand = Command.make(
  "call",
  {
    session: Options.text("session"),
    pairPassword: Options.text("pair-password").pipe(Options.optional),
    pairPasswordFile: pairPasswordFileOpt,
    target: Options.text("target"),
    action: Options.text("action"),
    argsJson: Options.text("args-json").pipe(Options.optional),
    id: Options.text("id").pipe(Options.optional),
    hostUrl: Options.text("host-url").pipe(Options.optional),
    settings: settingsPathOpt,
  },
  ({
    session,
    pairPassword,
    pairPasswordFile,
    target,
    action,
    argsJson,
    id,
    hostUrl,
    settings,
  }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteCall({
          session,
          ...(Option.isSome(pairPassword) ? { pairPassword: pairPassword.value } : {}),
          ...(Option.isSome(pairPasswordFile)
            ? { pairPasswordFile: pairPasswordFile.value }
            : {}),
          target,
          action,
          ...(Option.isSome(argsJson) ? { argsJson: argsJson.value } : {}),
          ...(Option.isSome(id) ? { id: id.value } : {}),
          ...(Option.isSome(hostUrl) ? { hostUrl: hostUrl.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(Effect.flatMap((output) => Console.log(output))),
);

export const remoteCommand = Command.make("remote", {}).pipe(
  Command.withSubcommands([
    remoteOpenCommand,
    remoteBoardCommand,
    remoteCallCommand,
    remoteDriveCommand,
    remoteListCommand,
    remoteRevokeCommand,
  ]),
);

export const remoteCommands = [remoteCommand];
