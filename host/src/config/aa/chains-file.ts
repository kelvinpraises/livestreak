import { readFileSync } from "node:fs";
import type { Hex } from "viem";
import type { AaChainConfig } from "../../services/aa/chains.js";

// --- exports ---

export interface AaChainFileEntry {
  readonly routeKey: string;
  readonly chainId: number;
  readonly name: string;
  readonly entryPoint: string;
  readonly safeModule?: string;
  readonly bundlerUrl?: string;
  readonly rpcUrl?: string;
  readonly executorPrivateKey?: string;
  readonly executorKeyEnv?: string;
  readonly paymasterAddress?: string;
}

export const readChainsFromFile = (filePath: string): AaChainConfig[] => {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("aa_chains_file_must_be_array");
  }

  const chains = parsed.map((entry, index) => parseChainEntry(entry, index));
  assertUniqueRouteKeys(chains);
  return chains;
};

// --- helpers ---

const HEX_PRIVATE_KEY = /^0x[a-fA-F0-9]{64}$/u;
const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/u;

const parseChainEntry = (entry: unknown, index: number): AaChainConfig => {
  if (entry === null || typeof entry !== "object") {
    throw new Error(`aa_chains_file_entry_${index}_invalid`);
  }

  const record = entry as AaChainFileEntry;
  const routeKey = requireString(record.routeKey, `aa_chains_file_entry_${index}_routeKey`);
  const chainId = requireNumber(record.chainId, `aa_chains_file_entry_${index}_chainId`);
  const name = requireString(record.name, `aa_chains_file_entry_${index}_name`);
  const entryPoint = requireHexAddress(record.entryPoint, `aa_chains_file_entry_${index}_entryPoint`);

  const executorPrivateKey = resolveExecutorKey(record, index);
  const paymasterAddress =
    record.paymasterAddress === undefined
      ? undefined
      : requireHexAddress(record.paymasterAddress, `aa_chains_file_entry_${index}_paymasterAddress`);

  return {
    routeKey,
    chainId,
    name,
    entryPoint,
    ...(record.safeModule === undefined ? {} : { safeModule: record.safeModule }),
    ...(record.bundlerUrl === undefined ? {} : { bundlerUrl: record.bundlerUrl }),
    ...(record.rpcUrl === undefined ? {} : { rpcUrl: record.rpcUrl }),
    ...(executorPrivateKey === undefined ? {} : { executorPrivateKey }),
    ...(paymasterAddress === undefined ? {} : { paymasterAddress: paymasterAddress as Hex })
  };
};

const resolveExecutorKey = (record: AaChainFileEntry, index: number): Hex | undefined => {
  if (record.executorKeyEnv !== undefined && record.executorKeyEnv.length > 0) {
    const value = process.env[record.executorKeyEnv];
    if (value === undefined || value.length === 0) {
      return undefined;
    }

    return requireHexPrivateKey(value, `aa_chains_file_entry_${index}_executorKeyEnv`);
  }

  if (record.executorPrivateKey === undefined || record.executorPrivateKey.length === 0) {
    return undefined;
  }

  return requireHexPrivateKey(
    record.executorPrivateKey,
    `aa_chains_file_entry_${index}_executorPrivateKey`
  );
};

const assertUniqueRouteKeys = (chains: readonly AaChainConfig[]): void => {
  const seen = new Set<string>();

  for (const chain of chains) {
    if (seen.has(chain.routeKey)) {
      throw new Error(`aa_chains_duplicate_routeKey:${chain.routeKey}`);
    }

    seen.add(chain.routeKey);
  }
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_required`);
  }

  return value;
};

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}_required`);
  }

  return value;
};

const requireHexAddress = (value: unknown, label: string): string => {
  const text = requireString(value, label);
  if (!HEX_ADDRESS.test(text)) {
    throw new Error(`${label}_invalid_hex`);
  }

  return text;
};

const requireHexPrivateKey = (value: string, label: string): Hex => {
  if (!HEX_PRIVATE_KEY.test(value)) {
    throw new Error(`${label}_invalid_hex`);
  }

  return value as Hex;
};
