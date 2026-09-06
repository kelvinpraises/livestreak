import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import type { BridgeCaller, CallActionEnvelope } from "@livestreak/schema";
import { createOptionsEdge } from "../adapters/options.js";
import { resolveOperatorContext } from "../gateway/operator.js";
import { resolvePassword } from "../gateway/password.js";
import { defaultKeystorePath, ensureAndUnlock } from "../gateway/keystore.js";
import { createRelay, type DispatchFn } from "../gateway/relay.js";
import { SessionRegistry, parseScopes, parseTtlMs } from "../gateway/session.js";
import { generatePairingPassword, makePasswordVerifier } from "../gateway/pairing.js";
import { projectConsoleFunctions } from "../gateway/console-functions.js";
import {
  activeSessions,
  defaultSessionStorePath,
  loadSessions,
  markRevoked,
  upsertSession,
  type StoredSession
} from "../gateway/session-store.js";
import { connectGateway } from "../gateway/wss-client.js";
import { configOpt, passwordOpt, readCommandConfig } from "./args.js";

// Derive the leg-A WSS url from the configured host http(s) url unless overridden.
const deriveHostWss = (hostUrl: string, override?: string): string => {
  if (override !== undefined) {
    return override;
  }
  const env = process.env["LIVESTREAK_HOST_WSS"];
  if (env !== undefined) {
    return env;
  }
  return `${hostUrl.replace(/^http/, "ws").replace(/\/$/, "")}/control`;
};

// `remote open` — mint a scoped, expiring session, dial the host, and run the relay loop until SIGINT.
export const runRemoteOpen = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly scopes: string;
  readonly ttl: string;
  readonly spendCap?: string;
  readonly hostWss?: string;
  readonly pairPassword?: string;
}): Promise<string> => {
  const scopes = parseScopes(input.scopes);
  const ttlMs = parseTtlMs(input.ttl);
  const spendCapUSDC = input.spendCap === undefined ? undefined : BigInt(input.spendCap);

  // The PAIRING password is shared with the remote user and is SEPARATE from the keystore password.
  // Only its scrypt verifier crosses the wire; the host never sees the plaintext.
  const pairingPassword = input.pairPassword ?? generatePairingPassword();
  const passwordVerifier = makePasswordVerifier(pairingPassword);

  const password = await resolvePassword(input.password);
  const ctx = await resolveOperatorContext({ ...input, password });

  // Unlock (creating on first run) the encrypted-at-rest keystore; the seed lives in memory only.
  const keystorePath = defaultKeystorePath();
  const unlocked = await ensureAndUnlock(keystorePath, ctx.seed, password);

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

  // Seed-bound options bridge; dispatch hands the package the unlocked seed (the package builds its
  // own wallet — deterministic). The seed NEVER leaves this closure.
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: unlocked.seed,
    userAddress: ctx.userAddress
  });
  const dispatch: DispatchFn = async (caller: BridgeCaller, envelope: CallActionEnvelope) => {
    const result = await edge.bridge.callAction(
      caller as Parameters<typeof edge.bridge.callAction>[0],
      envelope as Parameters<typeof edge.bridge.callAction>[1]
    );
    if (typeof result === "object" && result !== null) {
      const r = result as { txId?: unknown; tokenId?: unknown };
      return {
        ...(r.txId === undefined ? {} : { txId: String(r.txId) }),
        ...(r.tokenId === undefined ? {} : { tokenId: String(r.tokenId) })
      };
    }
    return { txId: String(result) };
  };

  // Project the in-scope console function catalog (best-effort: a chain-read failure must not stop the
  // daemon — the host can still relay; the UI just renders no auto-forms until functions arrive).
  let consoleFunctions: readonly import("@livestreak/schema").FunctionDescriptor[] = [];
  try {
    consoleFunctions = projectConsoleFunctions(await edge.describeFunctions(), scopes);
  } catch (error) {
    console.error(`[gateway] function projection skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const relay = createRelay({ registry, dispatch });
  const hostWss = deriveHostWss(ctx.doc.host.url, input.hostWss);
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
        console.log(`remote console URL: ${remoteUrl}`);
      }
    },
    log: (line) => {
      // eslint-disable-next-line no-console
      console.error(`[gateway] ${line}`);
    }
  });
  wss.register({
    record,
    passwordVerifier,
    ...(consoleFunctions.length === 0 ? {} : { functions: consoleFunctions })
  });

  // Cross-process revoke + TTL expiry watcher: sync store revocations into the live registry; lock &
  // exit when the session ends.
  const shutdown = (reason: string): void => {
    registry.revoke(record.sessionId);
    wss.revoke(record.sessionId);
    void markRevoked(storePath, record.sessionId);
    wss.close();
    unlocked.lock(); // zeroize the seed — never hold it without a supervisor
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

const scopesOpt = Options.text("scopes").pipe(
  Options.withDescription("Comma-separated granular scopes, e.g. bridge:action:fund,bridge:board:read")
);
const ttlOpt = Options.text("ttl").pipe(Options.withDescription("Session lifetime, e.g. 30m, 1h, 90s"));
const spendCapOpt = Options.text("spend-cap").pipe(Options.optional);
const hostWssOpt = Options.text("host-wss").pipe(Options.optional);
const pairPasswordOpt = Options.text("pair-password").pipe(
  Options.withDescription("Pairing password shared with the remote user (generated if omitted)"),
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
    config: configOpt,
    password: passwordOpt
  },
  ({ scopes, ttl, spendCap, hostWss, pairPassword, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runRemoteOpen({
          scopes,
          ttl,
          ...(Option.isSome(spendCap) ? { spendCap: spendCap.value } : {}),
          ...(Option.isSome(hostWss) ? { hostWss: hostWss.value } : {}),
          ...(Option.isSome(pairPassword) ? { pairPassword: pairPassword.value } : {}),
          ...readCommandConfig(config, password)
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

export const remoteCommand = Command.make("remote", {}).pipe(
  Command.withSubcommands([remoteOpenCommand, remoteListCommand, remoteRevokeCommand])
);

export const remoteCommands = [remoteCommand];
