import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { Schema } from "effect";
import {
  DEFAULT_EVM_CAIP2,
  DEFAULT_HOST_URL,
  SettingsDoc,
  type ChainSettings,
  type SettingsDoc as SettingsDocType
} from "@livestreak/schema";
import { localhostDeployment } from "@livestreak/contracts/evm/deployments/localhost";

export const defaultSettingsPath = (): string => resolve(process.cwd(), "settings.json");

const FORBIDDEN_KEYS = ["seed", "seedHex", "password", "mnemonic", "secret"] as const;

const assertNoSecrets = (value: unknown, path = "root"): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Forbidden key "${key}" at ${path}`);
    }
    assertNoSecrets(nested, `${path}.${key}`);
  }
};

export const loadSettings = async (path: string = defaultSettingsPath()): Promise<SettingsDocType> => {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertNoSecrets(parsed);
  return Schema.decodeUnknownSync(SettingsDoc)(parsed);
};

export const saveSettings = async (
  path: string,
  doc: SettingsDocType
): Promise<void> => {
  const serialized = JSON.stringify(doc, null, 2);
  for (const key of FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Refusing to persist forbidden key "${key}" in settings`);
    }
  }
  await writeFile(path, `${serialized}\n`, "utf8");
};

// The wallet/contracts blob FLOATS: settings.json carries only the deployment ref + rpc + keystore
// slot. The CLI chain adapter (gateway/auth/chain-registry.ts) derives the contracts bag and the
// WalletInit from the named deployment at load time. Adding a chain is a new adapter, never a
// hand-maintained address blob in JSON.
export const buildDefaultSettings = (hostUrl: string = DEFAULT_HOST_URL): SettingsDocType => {
  const caip2 = DEFAULT_EVM_CAIP2;
  const chainSettings: ChainSettings = {
    deployment: "@livestreak/contracts/evm/deployments/localhost",
    rpc: localhostDeployment.rpc,
    wallet: { keystoreSlot: "evm-localhost" }
  };

  return {
    host: { url: hostUrl.replace(/\/$/, "") },
    defaultChain: caip2,
    chains: { [caip2]: chainSettings }
  };
};

/** Load settings from cwd, auto-creating defaults on first access. */
export const ensureSettings = async (path?: string): Promise<SettingsDocType> => {
  const settingsPath = path ?? defaultSettingsPath();
  try {
    await access(settingsPath);
    return loadSettings(settingsPath);
  } catch {
    const doc = buildDefaultSettings();
    await saveSettings(settingsPath, doc);
    return doc;
  }
};

export const chainSettingsFor = (
  doc: SettingsDocType,
  caip2: string = doc.defaultChain
): ChainSettings => {
  const chain = doc.chains[caip2];
  if (chain === undefined) {
    throw new Error(`settings.json has no chain entry for ${caip2}`);
  }
  return chain;
};
