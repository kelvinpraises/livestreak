import type { Detection } from "./detection.js";
import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export type BookmakerDecision =
  | {
      readonly action: "createVault";
      readonly draft: VaultDraft;
      readonly detection: Detection;
    }
  | {
      readonly action: "joinVault";
      readonly vaultId: string;
      readonly draft: VaultDraft;
      readonly detection: Detection;
    }
  | {
      readonly action: "skip";
      readonly reason: BookmakerSkipReason;
      readonly detection?: Detection;
    };

export type BookmakerSkipReason =
  | "no_detectors"
  | "no_detection"
  | "below_confidence_threshold"
  | "duplicate_vault"
  | "steward_warning"
  | "invalid_draft"
  | "market_not_found"
  | "market_inactive";
