import type { StewardPanelView } from "../../model/panel.js";
import type { StewardSubjectKind } from "../../model/subject.js";
import type { StewardStateSnapshot } from "../../runtime/store.js";

// --- exports ---

export type { StewardStateSnapshot } from "../../runtime/store.js";

export type StewardPanelInput = StewardStateSnapshot | StewardPanelView;

export interface StewardFunctionTarget {
  readonly kind: "subject" | "vault" | "steward" | "global";
  readonly subjectId?: string;
  readonly subjectKind?: StewardSubjectKind;
  readonly vaultId?: string;
  readonly stewardId?: string;
  readonly findingId?: string;
}

export interface StewardFunctionView {
  readonly name: string;
  readonly scope: string;
  readonly label: string;
  readonly input?: string;
  readonly target?: StewardFunctionTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export interface StewardControlsView {
  readonly runtimeId: string;
  readonly revision: number;
  readonly functions: readonly StewardFunctionView[];
}
