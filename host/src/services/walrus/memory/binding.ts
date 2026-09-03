import type { MarketMemoryBinding } from "@livestreak/host";
import type { MemWalAccountOperations } from "./memwal-ops.js";
import {
  memwalContextFromResolved,
  type ResolvedWalrus
} from "../../../infrastructure/walrus/network.js";

// --- exports ---

export interface MemoryBindingStoreConfig {
  readonly resolved: ResolvedWalrus;
  readonly resolveOwnerKey: () => Promise<string>;
  readonly ops: MemWalAccountOperations;
}

export interface MemoryBindingStore {
  readonly get: (marketId: string) => MarketMemoryBinding | undefined;
  readonly provision: (marketId: string) => Promise<MarketMemoryBinding>;
  readonly grantDelegate: (marketId: string, delegatePublicKeyHex: string) => Promise<void>;
  readonly hasDelegate: (accountId: string, delegatePublicKeyHex: string) => boolean;
}

export const createMemoryBindingStore = (
  storeConfig: MemoryBindingStoreConfig
): MemoryBindingStore => {
  const bindings = new Map<string, MarketMemoryBinding>();
  const delegatesByAccount = new Map<string, Set<string>>();
  let hostAccountId: string | null = null;
  const memwalNetwork = memwalContextFromResolved(storeConfig.resolved);

  return {
    get(marketId) {
      return bindings.get(marketId);
    },

    async provision(marketId) {
      const existing = bindings.get(marketId);
      if (existing !== undefined) {
        return existing;
      }

      if (hostAccountId === null) {
        const ownerKey = await storeConfig.resolveOwnerKey();
        const created = await storeConfig.ops.createHostAccount({
          suiPrivateKey: ownerKey,
          network: memwalNetwork
        });
        hostAccountId = created.accountId;
      }

      const binding: MarketMemoryBinding = {
        marketId,
        memWalAccountId: hostAccountId,
        namespace: `market:${marketId}`
      };
      bindings.set(marketId, binding);
      return binding;
    },

    async grantDelegate(marketId, delegatePublicKeyHex) {
      const binding = bindings.get(marketId) ?? (await this.provision(marketId));
      const normalized = normalizeHex(delegatePublicKeyHex);

      if (hasDelegate(delegatesByAccount, binding.memWalAccountId, normalized)) {
        return;
      }

      const ownerKey = await storeConfig.resolveOwnerKey();
      await storeConfig.ops.grantDelegate({
        suiPrivateKey: ownerKey,
        accountId: binding.memWalAccountId,
        delegatePublicKeyHex: normalized,
        label: `market:${marketId}`,
        network: memwalNetwork
      });

      rememberDelegate(delegatesByAccount, binding.memWalAccountId, normalized);
    },

    hasDelegate(accountId, delegatePublicKeyHex) {
      return hasDelegate(delegatesByAccount, accountId, normalizeHex(delegatePublicKeyHex));
    }
  };
};

// --- helpers ---

const normalizeHex = (value: string): string => value.trim().replace(/^0x/iu, "");

const hasDelegate = (
  delegatesByAccount: Map<string, Set<string>>,
  accountId: string,
  delegatePublicKeyHex: string
): boolean => delegatesByAccount.get(accountId)?.has(delegatePublicKeyHex) ?? false;

const rememberDelegate = (
  delegatesByAccount: Map<string, Set<string>>,
  accountId: string,
  delegatePublicKeyHex: string
): void => {
  const existing = delegatesByAccount.get(accountId) ?? new Set<string>();
  existing.add(delegatePublicKeyHex);
  delegatesByAccount.set(accountId, existing);
};
