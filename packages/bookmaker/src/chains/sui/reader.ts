// --- exports ---

// Multichain-hygiene: read VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import { Transaction, SuiJsonRpcClient, bcs, createSuiReadClient } from "@livestreak/wallet";
import { target } from "@livestreak/contracts/sui";

import type { BookmakerChainReader } from "../types.js";
import type { BookmakerSuiObjectIds } from "../addresses.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";
const SUI_BYTES32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

const bytes32ByteArray = (id: string): number[] => {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
};

export const createSuiBookmakerReader = (
  ids: BookmakerSuiObjectIds,
  rpcUrl: string
): BookmakerChainReader => {
  const client: SuiJsonRpcClient = createSuiReadClient(rpcUrl);

  return {
    // Read-only existence check via devInspect (zero-address sender). Best-effort: a malformed id or a
    // read failure resolves false — the on-chain create_vault still asserts market existence (E_UNKNOWN_MARKET).
    marketExists: async (marketId: string): Promise<boolean> => {
      if (!SUI_BYTES32_RE.test(marketId)) {
        return false;
      }
      const tx = new Transaction();
      tx.moveCall({
        target: target(ids.packageId, "market_registry", "market_exists"),
        arguments: [
          tx.object(ids.marketRegistry),
          tx.pure(bcs.vector(bcs.u8()).serialize(bytes32ByteArray(marketId)).toBytes())
        ]
      });
      try {
        const result = await client.devInspectTransactionBlock({
          sender: ZERO_ADDRESS,
          transactionBlock: tx
        });
        const returnValue = result.results?.[0]?.returnValues?.[0];
        const rawBytes = returnValue?.[0];
        return Array.isArray(rawBytes) && rawBytes[0] === 1;
      } catch {
        return false;
      }
    }
  };
};
