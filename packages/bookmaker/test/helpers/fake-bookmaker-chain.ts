import type {
  BookmakerChain,
  CreateVaultInput,
  CreateVaultResult,
  TxId
} from "../../src/chains/types.js";
import { asTxId, asVaultId } from "../../src/chains/types.js";

export const FAKE_MARKET_ID = `0x${"11".repeat(32)}` as const;
export const FAKE_VAULT_ID = `0x${"22".repeat(32)}` as const;

export type FakeBookmakerChainHooks = {
  readonly onCreateVault?: (
    input: CreateVaultInput
  ) => CreateVaultResult | Promise<CreateVaultResult>;
  readonly onConfirmCreateVault?: (
    userOpHash: TxId
  ) => CreateVaultResult | undefined | Promise<CreateVaultResult | undefined>;
};

export const createFakeBookmakerChain = (
  hooks?: FakeBookmakerChainHooks | ((input: CreateVaultInput) => CreateVaultResult | Promise<CreateVaultResult>)
): BookmakerChain => {
  const resolvedHooks: FakeBookmakerChainHooks =
    typeof hooks === "function" ? { onCreateVault: hooks } : (hooks ?? {});

  return {
    reader: {
      marketExists: async () => true
    },
    writer: {
      createVault: async (input) => {
        if (resolvedHooks.onCreateVault !== undefined) {
          return resolvedHooks.onCreateVault(input);
        }

        void input;
        return {
          txId: asTxId(`0x${"aa".repeat(32)}`),
          vaultId: asVaultId(FAKE_VAULT_ID)
        };
      },
      confirmCreateVault: async (userOpHash) => {
        if (resolvedHooks.onConfirmCreateVault !== undefined) {
          return resolvedHooks.onConfirmCreateVault(userOpHash);
        }

        void userOpHash;
        return undefined;
      }
    }
  };
};
