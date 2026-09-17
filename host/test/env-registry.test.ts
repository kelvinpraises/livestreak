import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Registry-with-teeth: the SINGLE source of truth for every environment variable host/src is allowed
// to read. Add a var here when (and only when) you add a documented env read — an undocumented read
// makes this test RED. Keep deploy-host.yml's header inventory consistent with this list.
//
// The dynamic `process.env[record.executorKeyEnv]` read in config/aa/chains-file.ts is exempt by
// design (the key name is operator-supplied at runtime, not a fixed var) and is excluded below.
const ALLOWLIST: readonly string[] = [
  // --- Node / test runtime ---
  "NODE_ENV",
  "VITEST",
  // --- Host identity + binding ---
  "LIVESTREAK_HOST_ID",
  "LIVESTREAK_HOST_BASE_URL",
  "LIVESTREAK_HOST_BIND_HOST",
  "LIVESTREAK_HOST_BIND_PORT",
  // --- Account-abstraction (EVM) ---
  "LIVESTREAK_AA_FROM_DEPLOY",
  "LIVESTREAK_AA_CHAINS_FILE",
  "LIVESTREAK_AA_CHAIN_ID",
  "LIVESTREAK_AA_RPC_URL",
  "LIVESTREAK_AA_ENTRY_POINT",
  "LIVESTREAK_AA_SAFE_MODULE",
  "LIVESTREAK_AA_BUNDLER_URL",
  "LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY",
  "LIVESTREAK_AA_OPERATOR_KEY",
  "LIVESTREAK_AA_ALLOW_DEV_KEY",
  "LIVESTREAK_AA_PAYMASTER_ADDRESS",
  "LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN",
  "LIVESTREAK_DEPLOY_SNAPSHOT",
  // --- Sui ---
  "LIVESTREAK_SUI_NETWORK",
  "LIVESTREAK_SUI_RPC_URL",
  "LIVESTREAK_SUI_DEPLOYMENT",
  "LIVESTREAK_SUI_SPONSOR_SEED",
  "LIVESTREAK_SUI_SPONSOR_MNEMONIC",
  "LIVESTREAK_SUI_GAS_BUDGET",
  "LIVESTREAK_SUI_MAX_GAS_BUDGET",
  "LIVESTREAK_SUI_GAS_PRICE",
  "LIVESTREAK_SUI_GAS_COIN_MIST",
  "LIVESTREAK_SUI_GAS_POOL_SIZE",
  "LIVESTREAK_SUI_GAS_RESERVE_TIMEOUT_MS",
  "LIVESTREAK_SUI_MIN_SPONSOR_BALANCE_MIST",
  // --- Walrus ---
  "LIVESTREAK_WALRUS_NETWORK",
  "LIVESTREAK_WALRUS_CONTENT_EPHEMERAL_EPOCHS",
  "LIVESTREAK_WALRUS_CONTENT_LOCKED_EPOCHS",
  // --- Memory / wallet ---
  "LIVESTREAK_WALLET_SEED",
  // --- Remote bridge console ---
  "LIVESTREAK_APP_ORIGIN",
  "LIVESTREAK_REMOTE_GATEWAY_TOKEN",
  "LIVESTREAK_REMOTE_GRANT_KEY",
  "LIVESTREAK_REMOTE_SESSION_TTL_MS",
  // --- Catalog / cron / agents ---
  "LIVESTREAK_CATALOG_DEFAULT_CHAIN",
  "LIVESTREAK_CATALOG_MARKETS",
  "LIVESTREAK_RESET_CATALOG",
  "LIVESTREAK_CRON_DISABLED",
  "LIVESTREAK_AGENTS_JSON",
  // --- External services ---
  "DATABASE_URL",
  "LIVEKIT_API_KEY"
];

const HOST_SRC = resolve(fileURLToPath(import.meta.url), "..", "..", "src");

const listTsFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
};

// Collect env keys the same way the audit grep does: direct `process.env.X` / `process.env["X"]`
// literals, plus the fixed string keys passed to host's env-reader helpers (readOptionalEnv/readEnv/
// readIntEnv/readBigIntEnv/readPositiveIntEnv). The dynamic `process.env[record.executorKeyEnv]` read
// carries no literal, so it never enters this set — exempt by design.
const collectEnvKeys = (): Set<string> => {
  const direct = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\])/g;
  const helper =
    /read(?:OptionalEnv|Env|IntEnv|BigIntEnv|PositiveIntEnv)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
  const keys = new Set<string>();
  for (const file of listTsFiles(HOST_SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(direct)) {
      keys.add(match[1] ?? match[2]!);
    }
    for (const match of source.matchAll(helper)) {
      keys.add(match[1]!);
    }
  }
  return keys;
};

describe("host env registry", () => {
  it("every env var read in host/src is in the allowlist (no undocumented vars)", () => {
    const read = collectEnvKeys();
    const allow = new Set(ALLOWLIST);

    const undocumented = [...read].filter((k) => !allow.has(k)).sort();
    const stale = [...allow].filter((k) => !read.has(k)).sort();

    expect(
      { undocumented, stale },
      `undocumented=${undocumented.join(",")} stale=${stale.join(",")}`
    ).toEqual({ undocumented: [], stale: [] });
  });

  it("has no duplicate allowlist entries", () => {
    expect(ALLOWLIST.length).toBe(new Set(ALLOWLIST).size);
  });
});
