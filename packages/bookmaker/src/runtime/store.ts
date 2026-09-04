import type { BookmakerDecision } from "../model/decision.js";
import type { Detection } from "../model/detection.js";
import type { BookmakerPanelView } from "../model/panel.js";
import type { SimilarityResult } from "../model/similarity.js";
import type { VaultDraft } from "../model/vault-draft.js";
import type { BookmakerWriteIntent } from "../model/write-intent.js";
import type { CreateVaultResult } from "../chains/types.js";

// --- exports ---

export interface BookmakerRuntimeState {
  readonly runtimeId: string;
  readonly revision: number;
  readonly latestDetection?: Detection;
  readonly currentDraft?: VaultDraft;
  readonly similarityResult?: SimilarityResult;
  readonly lastDecision?: BookmakerDecision;
  readonly pendingWriteIntents: readonly BookmakerWriteIntent[];
  readonly completedVaultCreations: readonly {
    readonly intent: Extract<BookmakerWriteIntent, { readonly action: "createVault" }>;
    readonly result: CreateVaultResult;
  }[];
  readonly panel?: BookmakerPanelView;
  readonly lastError?: string;
  readonly updatedAtMs: number;
}

export interface BookmakerRuntimeStore {
  readonly readState: () => BookmakerRuntimeState;
  readonly publish: (patch: Partial<BookmakerRuntimeState>) => BookmakerRuntimeState;
}

export const createBookmakerRuntimeStore = (runtimeId: string): BookmakerRuntimeStore => {
  let state: BookmakerRuntimeState = {
    runtimeId,
    revision: 0,
    pendingWriteIntents: [],
    completedVaultCreations: [],
    updatedAtMs: 0
  };

  return {
    readState: () => state,
    publish: (patch) => {
      state = {
        ...state,
        ...patch,
        revision: state.revision + 1,
        updatedAtMs: patch.updatedAtMs ?? state.updatedAtMs
      };
      return state;
    }
  };
};
