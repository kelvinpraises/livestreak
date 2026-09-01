import type { BookmakerDecision } from "./decision.js";
import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export interface BookmakerWritePlan {
  readonly decision: BookmakerDecision;
  readonly intents: readonly BookmakerWriteIntent[];
}

export type BookmakerWriteIntent =
  | {
      readonly action: "createVault";
      readonly marketId: string;
      readonly draft: VaultDraft;
    }
  | {
      readonly action: "joinExistingVault";
      readonly marketId: string;
      readonly vaultId: string;
      readonly draft: VaultDraft;
    };

export interface BookmakerContractsSurface {
  readonly vaultAddress: string;
  readonly marketRegistryAddress?: string;
  readonly agentRegistryAddress?: string;
}
