import { addDelegateKey, createAccount } from "@mysten-incubation/memwal/account";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { MemWalNetworkContext } from "../../../infrastructure/walrus/network.js";

// --- exports ---

export interface MemWalGrantDelegateInput {
  readonly suiPrivateKey: string;
  readonly accountId: string;
  readonly delegatePublicKeyHex: string;
  readonly label: string;
  readonly network: MemWalNetworkContext;
}

export interface MemWalGrantDelegateResult {
  readonly suiAddress: string;
  readonly digest: string;
}

export interface MemWalAccountOperations {
  readonly createHostAccount: (input: {
    readonly suiPrivateKey: string;
    readonly network: MemWalNetworkContext;
  }) => Promise<{ readonly accountId: string }>;
  readonly grantDelegate: (input: MemWalGrantDelegateInput) => Promise<MemWalGrantDelegateResult>;
}

export const createMemWalAccountOperations = (): MemWalAccountOperations => ({
  async createHostAccount({ suiPrivateKey, network }) {
    const suiClient = new SuiJsonRpcClient({
      url: network.suiRpcUrl,
      network: network.network
    });
    const result = await createAccount({
      packageId: network.packageId,
      registryId: network.registryId,
      suiPrivateKey,
      suiClient,
      suiNetwork: network.network
    });

    if (result.accountId.length === 0) {
      throw new Error("MemWal createAccount returned an empty accountId");
    }

    return { accountId: result.accountId };
  },

  async grantDelegate({ suiPrivateKey, accountId, delegatePublicKeyHex, label, network }) {
    const suiClient = new SuiJsonRpcClient({
      url: network.suiRpcUrl,
      network: network.network
    });
    const result = await addDelegateKey({
      packageId: network.packageId,
      accountId,
      publicKey: normalizePublicKeyHex(delegatePublicKeyHex),
      label,
      suiPrivateKey,
      suiClient,
      suiNetwork: network.network
    });

    return {
      suiAddress: result.suiAddress,
      digest: result.digest
    };
  }
});

// --- helpers ---

const normalizePublicKeyHex = (value: string): string => value.replace(/^0x/iu, "");
