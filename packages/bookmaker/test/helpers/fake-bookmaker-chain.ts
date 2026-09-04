import type { BookmakerChain, CreateVaultInput, CreateVaultResult } from "../../src/chains/types.js";
import { asTxId, asVaultId } from "../../src/chains/types.js";

export const FAKE_MARKET_ID = `0x${"11".repeat(32)}` as const;
export const FAKE_VAULT_ID = `0x${"22".repeat(32)}` as const;

export const createFakeBookmakerChain = (
  onCreateVault?: (input: CreateVaultInput) => CreateVaultResult | Promise<CreateVaultResult>
): BookmakerChain => ({
  reader: {
    marketExists: async () => true
  },
  writer: {
    createVault: async (input) => {
      if (onCreateVault !== undefined) {
        return onCreateVault(input);
      }

      void input;
      return {
        txId: asTxId(`0x${"aa".repeat(32)}`),
        vaultId: asVaultId(FAKE_VAULT_ID)
      };
    }
  }
});
