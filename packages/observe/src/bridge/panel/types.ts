import type { BoardCellStatus } from "#run/control/board/index.js";
import type { JsonSchema } from "#run/control/catalog.js";

export interface ControlsView {
  readonly runId: string;
  readonly revision: number;
  readonly cells: readonly ControlCellView[];
}

export interface ControlCellView {
  readonly id: string;
  readonly kind: string;
  readonly catalog?: string;
  readonly label: string;
  readonly order: number;
  readonly status: BoardCellStatus;
  readonly state: string;
  readonly message: string | null;
  readonly updatedAtMs: number;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly readonly: Readonly<Record<string, unknown>>;
  readonly refs: Readonly<Record<string, string>>;
  readonly functions: readonly ControlFunctionView[];
}

export interface ControlFunctionView {
  readonly name: string;
  readonly scope: string;
  readonly label?: string;
  readonly description?: string;
  readonly resultKind?: string;
  readonly input?: JsonSchema;
  readonly output?: JsonSchema;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}
