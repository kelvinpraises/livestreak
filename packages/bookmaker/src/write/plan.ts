import type { BookmakerDecision } from "../model/decision.js";
import type {
  BookmakerContractsSurface,
  BookmakerWriteIntent,
  BookmakerWritePlan
} from "../model/write-plan.js";

// --- exports ---

export const planBookmakerWrite = (
  decision: BookmakerDecision,
  _contracts: BookmakerContractsSurface
): BookmakerWritePlan => ({
  decision,
  intents: writeIntentsFromDecision(decision)
});

// --- helpers ---

const writeIntentsFromDecision = (decision: BookmakerDecision): readonly BookmakerWriteIntent[] => {
  if (decision.action === "skip") {
    return [];
  }

  if (decision.action === "joinVault") {
    return [
      {
        action: "joinExistingVault",
        marketId: decision.draft.marketId,
        vaultId: decision.vaultId,
        draft: decision.draft
      }
    ];
  }

  return [
    {
      action: "createVault",
      marketId: decision.draft.marketId,
      draft: decision.draft
    }
  ];
};
