// --- exports ---

// Multichain-hygiene: derive PDAs + read accounts VIA @livestreak/wallet (the single @solana/* owner).
import { address, createSolanaRpc, findMarketPda } from "@livestreak/wallet";

import type { BookmakerChainReader } from "../types.js";
import type { BookmakerSolanaAddresses } from "../addresses.js";

const SOLANA_HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

export const createSolanaBookmakerReader = (
  addresses: BookmakerSolanaAddresses,
  rpcUrl: string
): BookmakerChainReader => {
  const programId = address(addresses.programId);
  const rpc = createSolanaRpc(rpcUrl);

  return {
    // Existence check by probing the Market PDA (["market", market_id]). Best-effort: a malformed id
    // or read failure resolves false — create_vault_seeded still fails on-chain if the market/protocol
    // state is absent (the UserEngineOp accounts won't resolve).
    marketExists: async (marketId: string): Promise<boolean> => {
      if (!SOLANA_HEX32_RE.test(marketId)) {
        return false;
      }
      try {
        const [marketPda] = await findMarketPda(programId, marketId);
        const { value } = await rpc.getAccountInfo(marketPda, { encoding: "base64" }).send();
        return value !== null;
      } catch {
        return false;
      }
    }
  };
};
