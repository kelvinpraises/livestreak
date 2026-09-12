import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import type { BridgeCaller, CallActionEnvelope } from "@livestreak/schema";
import { createConsoleEdges } from "../gateway/console/edges.js";
import {
  buildConsoleRoutes,
  createMergedDispatch,
  mergeConsoleDescriptors,
  type ConsoleEdge
} from "../gateway/console/edge.js";
import { resolvePassword } from "../gateway/auth/password.js";
import { resolveOperator } from "../gateway/auth/identity.js";
import { defaultKeystorePath, ensureAndUnlock } from "../gateway/auth/keystore.js";
import { createRelay } from "../gateway/remote/relay.js";
import { SessionRegistry, parseScopes, parseTtlMs } from "../gateway/session/registry.js";
import { generatePairingPassword, makePasswordVerifier } from "../gateway/session/pairing.js";
import { projectConsoleFunctions } from "../gateway/console/functions.js";
import { buildSessionWallet } from "../gateway/auth/session-wallet.js";
import {
  activeSessions,
  defaultSessionStorePath,
  loadSessions,
  markRevoked,
  upsertSession,
  type StoredSession
} from "../gateway/session/store.js";
import { connectGateway } from "../gateway/remote/wss-client.js";
import { runRemoteDrive as executeRemoteDrive } from "../gateway/remote/driver.js";
import { ensureSettings, defaultSettingsPath } from "../prefs/settings.js";
import { passwordOpt } from "./args.js";

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
  (override ?? process.env["LIVESTREAK_APP_ORIGIN"] ?? "http://localhost:3000").replace(/\/$/, "");

const appRemoteUrl = (origin: string, sessionId: string): string =>
  `${origin}/remote/${encodeURIComponent(sessionId)}`;

const serializeRemoteBoard = (board: unknown): unknown =>
  JSON.parse(
    JSON.stringify(board, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );

export const runRemoteOpen = async (input: {
  readonly settingsPath?: string;
  readonly password?: string;
  readonly scopes: string;
  readonly ttl: string;
  readonly spendCap?: string;
  readonly hostWss?: string;
  readonly pairPassword?: string;
  readonly appOrigin?: string;
}): Promise<string> => {
  const appOrigin = resolveAppOrigin(input.appOrigin);
  const scopes = parseScopes(input.scopes);
  const ttlMs = parseTtlMs(input.ttl);
  const spendCapUSDC = input.spendCap === undefined ? undefined : BigInt(input.spendCap);

  const pairingPassword = input.pairPassword ?? generatePairingPassword();
  const passwordVerifier = makePasswordVerifier(pairingPassword);

  const settingsPath = input.settingsPath ?? defaultSettingsPath();
  const settings = await ensureSettings(settingsPath);
  const password = await resolvePassword(input.password);
  const { seed } = resolveOperator(password);
  const sessionWallet = await buildSessionWallet(settings, seed);

  const keystorePath = defaultKeystorePath();
  const unlocked = await ensureAndUnlock(keystorePath, seed, password);

  const storePath = defaultSessionStorePath();
  const registry = new SessionRegistry();
  const record = registry.mint({
    scopes,
    ttlMs,
    ...(spendCapUSDC === undefined ? {} : { spendCapUSDC })
  });

  const persist = async (remoteUrl?: string): Promise<void> => {
    const stored: StoredSession = {
      sessionId: record.sessionId,
      scopes: record.scopes,
      createdAtMs: record.createdAtMs,
      expiresAt: record.expiresAt,
      ...(spendCapUSDC === undefined ? {} : { spendCapUSDC: spendCapUSDC.toString() }),
      spentUSDC: record.spentUSDC.toString(),
      revoked: record.revoked,
      ...(remoteUrl === undefined ? {} : { remoteUrl })
    };
    await upsertSession(storePath, stored);
  };
  await persist();

  const runId = `remote-${record.sessionId}`;
  const consoleEdges: ConsoleEdge[] = createConsoleEdges({
    settings,
    sessionWallet,
    runId
  });

  const log = (line: string): void => {
    // eslint-disable-next-line no-console
    console.error(`[gateway] ${line}`);
  };

  const routes = await buildConsoleRoutes(consoleEdges);
  const dispatch = createMergedDispatch(routes, consoleEdges);

  let consoleFunctions: readonly import("@livestreak/schema").FunctionDescriptor[] = [];
  try {
    const raw = await mergeConsoleDescriptors(consoleEdges);
    consoleFunctions = projectConsoleFunctions(raw, scopes);
    log(`function catalog: ${raw.length} total, ${consoleFunctions.length} in scope`);
  } catch (error) {
    log(`function projection skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const relay = createRelay({
    registry,
    dispatch: (caller: BridgeCaller, envelope: CallActionEnvelope, target?: string) =>
      dispatch(caller, envelope, target)
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
        void persist(remoteUrl);
        // eslint-disable-next-line no-console
        console.log(`remote console URL: ${appRemoteUrl(appOrigin, record.sessionId)}`);
      }
    },
    log
  });
  // Board-first reveal: a board change can newly reveal (or hide) actions, so re-project the catalog
  // and re-push it. Without this the UI's function panel freezes at the open-time projection and
  // board-gated actions (observe register, options fund, …) never appear as buttons after configure.
  const refreshFunctions = async (): Promise<void> => {
    try {
      const raw = await mergeConsoleDescriptors(consoleEdges);
      wss.sendFunctions(record.sessionId, projectConsoleFunctions(raw, scopes));
    } catch (error) {
      log(`functions refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
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
      })
    );
  }
  void (async () => {
    for (const edge of consoleEdges) {
      try {
        await edge.refresh?.();
      } catch (error) {
        log(`${edge.package} board refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (edge.readBoard === undefined) {
        continue;
      }
      try {
        pushBoard(edge.package, await edge.readBoard());
      } catch (error) {
        log(`${edge.package} board snapshot skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })();
  wss.register({
    record,
    passwordVerifier,
    ...(consoleFunctions.length === 0 ? {} : { functions: consoleFunctions })
  });

  const shutdown = (reason: string): void => {
    for (const unsub of boardUnsubs) {
      unsub();
    }
    registry.revoke(record.sessionId);
    wss.revoke(record.sessionId);
    void markRevoked(storePath, record.sessionId);
    wss.close();
    unlocked.lock();
    // eslint-disable-next-line no-console
    console.error(`[gateway] session ${record.sessionId} closed (${reason})`);
  };

  return await new Promise<string>((resolve) => {
    const timer = setInterval(() => {
      void (async () => {
        const sessions = await loadSessions(storePath);
        const mine = sessions.find((s) => s.sessionId === record.sessionId);
        if (mine?.revoked === true) {
          registry.revoke(record.sessionId);
        }
        if (record.revoked || Date.now() >= record.expiresAt) {
          clearInterval(timer);
          shutdown(record.revoked ? "revoked" : "ttl_expired");
          resolve(`session ${record.sessionId} ended`);
        }
      })();
    }, 3000);
    timer.unref?.();

    const onSignal = (sig: string): void => {
      clearInterval(timer);
      shutdown(sig);
      resolve(`session ${record.sessionId} ended (${sig})`);
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));

    const ttlSecs = Math.round(ttlMs / 1000);
    // eslint-disable-next-line no-console
    console.log(
      [
        "livestreak remote open",
        "",
        `pairing code: ${record.sessionId}`,
        `pairing pass: ${pairingPassword}`,
        `console URL:  ${appRemoteUrl(appOrigin, record.sessionId)}`,
        `scopes:       ${record.scopes.join(", ")}`,
        `expires in:   ${ttlSecs}s`,
        spendCapUSDC === undefined ? "spend cap:    none" : `spend cap:    ${spendCapUSDC.toString()} (atomic USDC)`,
        `host (leg A): ${hostWss}`,
        "",
        "Share the pairing code AND pairing pass with the remote operator. Ctrl-C to revoke & exit."
      ].join("\n")
    );
  });
};

export const runRemoteList = async (): Promise<string> => {
  const storePath = defaultSessionStorePath();
  const sessions = activeSessions(await loadSessions(storePath));
  if (sessions.length === 0) {
    return "no active remote sessions";
  }
  return sessions
    .map((s) => {
      const cap = s.spendCapUSDC === undefined ? "none" : `${s.spentUSDC}/${s.spendCapUSDC}`;
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
  readonly hostUrl?: string;
  readonly settingsPath?: string;
  readonly marketId?: string;
  readonly observeOnly?: boolean;
  readonly fundDeposit?: string;
  readonly resolveOutcome?: string;
}): Promise<string> => {
  const result = await executeRemoteDrive({
    sessionId: input.session,
    pairingPassword: input.pairPassword,
    ...(input.hostUrl === undefined ? {} : { hostUrl: input.hostUrl }),
    ...(input.settingsPath === undefined ? {} : { settingsPath: input.settingsPath }),
    ...(input.marketId === undefined ? {} : { marketId: input.marketId }),
    ...(input.observeOnly === undefined ? {} : { observeOnly: input.observeOnly }),
    ...(input.fundDeposit === undefined ? {} : { fundDeposit: input.fundDeposit }),
    ...(input.resolveOutcome === undefined ? {} : { resolveOutcome: input.resolveOutcome })
  });
  const summary = result.steps.map((s) => `${s.target}:${s.action}=${s.ok ? "ok" : "fail"}`).join(" ");
  return `remote drive complete marketId=${result.marketId ?? "n/a"} ${summary}`;
};

const scopesOpt = Options.text("scopes").pipe(
  Options.withDescription("Comma-separated granular scopes, e.g. bridge:action:fund,bridge:board:read")
);
const ttlOpt = Options.text("ttl").pipe(Options.withDescription("Session lifetime, e.g. 30m, 1h, 90s"));
const spendCapOpt = Options.text("spend-cap").pipe(Options.optional);
const hostWssOpt = Options.text("host-wss").pipe(Options.optional);
const appOriginOpt = Options.text("app-origin").pipe(
  Options.withDescription("App origin for the printed remote console URL (default http://localhost:3000)"),
  Options.optional
);
const pairPasswordOpt = Options.text("pair-password").pipe(
  Options.withDescription("Pairing password shared with the remote user (generated if omitted)"),
  Options.optional
);
const settingsPathOpt = Options.text("settings").pipe(
  Options.withDescription("Path to settings.json"),
  Options.optional
);

const remoteOpenCommand = Command.make(
  "open",
  {
    scopes: scopesOpt,
    ttl: ttlOpt,
    spendCap: spendCapOpt,
    hostWss: hostWssOpt,
    pairPassword: pairPasswordOpt,
    appOrigin: appOriginOpt,
    settings: settingsPathOpt,
    password: passwordOpt
  },
  ({ scopes, ttl, spendCap, hostWss, pairPassword, appOrigin, settings, password }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteOpen({
          scopes,
          ttl,
          ...(Option.isSome(spendCap) ? { spendCap: spendCap.value } : {}),
          ...(Option.isSome(hostWss) ? { hostWss: hostWss.value } : {}),
          ...(Option.isSome(pairPassword) ? { pairPassword: pairPassword.value } : {}),
          ...(Option.isSome(appOrigin) ? { appOrigin: appOrigin.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
          ...(Option.isSome(password) ? { password: password.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const remoteListCommand = Command.make("list", {}, () =>
  Effect.tryPromise({
    try: () => runRemoteList(),
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const remoteRevokeCommand = Command.make(
  "revoke",
  { session: Options.text("session") },
  ({ session }) =>
    Effect.tryPromise({
      try: () => runRemoteRevoke(session),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const remoteDriveCommand = Command.make(
  "drive",
  {
    session: Options.text("session"),
    pairPassword: Options.text("pair-password"),
    hostUrl: Options.text("host-url").pipe(Options.optional),
    settings: settingsPathOpt,
    marketId: Options.text("market-id").pipe(Options.optional),
    observeOnly: Options.boolean("observe-only").pipe(Options.optional),
    fundDeposit: Options.text("fund-deposit").pipe(Options.optional),
    resolveOutcome: Options.text("resolve-outcome").pipe(Options.optional)
  },
  ({ session, pairPassword, hostUrl, settings, marketId, observeOnly, fundDeposit, resolveOutcome }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteDrive({
          session,
          pairPassword,
          ...(Option.isSome(hostUrl) ? { hostUrl: hostUrl.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {}),
          ...(Option.isSome(marketId) ? { marketId: marketId.value } : {}),
          ...(Option.isSome(observeOnly) ? { observeOnly: observeOnly.value } : {}),
          ...(Option.isSome(fundDeposit) ? { fundDeposit: fundDeposit.value } : {}),
          ...(Option.isSome(resolveOutcome) ? { resolveOutcome: resolveOutcome.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const remoteCommand = Command.make("remote", {}).pipe(
  Command.withSubcommands([remoteOpenCommand, remoteDriveCommand, remoteListCommand, remoteRevokeCommand])
);

export const remoteCommands = [remoteCommand];
