// --- exports ---

import type { TokenId, VaultId } from "../ids.js";
import type { OptionsVaultSide } from "../vault.js";

export type SessionPnlClaimRow = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly winningSide?: OptionsVaultSide;
  readonly claimable: bigint;
  readonly lossClaimable: bigint;
};

export type SessionPnlNftBalance = {
  readonly tokenId: TokenId;
  readonly remainingUSDC: bigint;
};

export type ProjectSessionPnlInput = {
  readonly claims: readonly SessionPnlClaimRow[];
  readonly nftBalances: readonly SessionPnlNftBalance[];
  readonly investedUSDC?: bigint;
};

export interface OptionsSessionPnlView {
  readonly returnedUSDC: string;
  readonly lossBasisUSDC: string;
  readonly remainingUSDC: string;
  readonly investedUSDC?: string;
  readonly netPnlUSDC?: string;
}

export const projectSessionPnl = (input: ProjectSessionPnlInput): OptionsSessionPnlView => {
  let returnedUSDC = 0n;
  let lossBasisUSDC = 0n;

  for (const row of input.claims) {
    if (row.winningSide === undefined) {
      continue;
    }

    if (row.side === row.winningSide) {
      returnedUSDC += row.claimable;
    } else {
      lossBasisUSDC += row.lossClaimable;
    }
  }

  let remainingUSDC = 0n;
  for (const balance of input.nftBalances) {
    remainingUSDC += balance.remainingUSDC;
  }

  const view: OptionsSessionPnlView = {
    returnedUSDC: returnedUSDC.toString(),
    lossBasisUSDC: lossBasisUSDC.toString(),
    remainingUSDC: remainingUSDC.toString()
  };

  if (input.investedUSDC === undefined) {
    return view;
  }

  return {
    ...view,
    investedUSDC: input.investedUSDC.toString(),
    netPnlUSDC: (returnedUSDC + remainingUSDC - input.investedUSDC).toString()
  };
};
