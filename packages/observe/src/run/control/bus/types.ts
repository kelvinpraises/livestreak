import type { ControlCallEnvelope, ControlArtifact, ControlCallResult } from "./calls.js";

export type BoardCellId = string;

export type BoardCellStatus = readonly [state: string, message: string | null, updatedAtMs: number];

export interface BoardCell {
  readonly label: string;
  readonly catalog?: string;
  readonly status: BoardCellStatus;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly readonly?: Readonly<Record<string, unknown>>;
  readonly refs?: Readonly<Record<string, string>>;
  readonly functions: readonly string[];
}

export interface BoardSectionPatch {
  readonly set?: Readonly<Record<string, unknown>>;
  readonly unset?: readonly string[];
}

export interface BoardCellPatch {
  /** When true, remove this cell from the board (configurator close). */
  readonly remove?: boolean;
  /** When the cell id is absent, supply a full cell to mount (board-first configure). */
  readonly create?: BoardCell;
  readonly settings?: BoardSectionPatch;
  readonly readonly?: BoardSectionPatch;
  readonly status?: BoardCellStatus;
  readonly refs?: BoardSectionPatch;
  readonly label?: string;
  readonly catalog?: string;
  readonly functions?: readonly string[];
}

export interface BoardPatch {
  readonly cells?: Readonly<Record<BoardCellId, BoardCellPatch>>;
}

export interface DescribeControlContext {
  readonly runId: string;
  readonly instanceId?: string;
  readonly nowMs?: number;
}

export interface ControlCellDefinition {
  readonly id: BoardCellId;
  readonly cell: BoardCell;
}

export interface ControlFunctionContext {
  readonly boardRevision: number;
  readonly board: import("#run/control/board/index.js").Board;
}

export interface ControlFunctionArtifactDraft {
  readonly kind: string;
  readonly ownerCell: BoardCellId;
  readonly function: string;
  readonly createdAtMs: number;
  readonly expiresAtMs?: number;
  readonly payload: unknown;
}

export interface ControlFunctionResult {
  readonly artifact?: ControlFunctionArtifactDraft;
  readonly boardPatch?: BoardPatch;
}

export interface ControlFunctionEntry {
  readonly name: string;
  readonly scope: string;
  readonly call: (
    envelope: ControlCallEnvelope,
    context: ControlFunctionContext
  ) => import("effect").Effect.Effect<ControlFunctionResult, import("@livestreak/core").LiveStreakError>;
}

export interface ControlSurface {
  readonly cell: ControlCellDefinition;
  readonly functions: readonly ControlFunctionEntry[];
}

export interface ControlPanel {
  readonly board: import("#run/control/board/index.js").Board;
  readonly catalog?: import("#run/control/catalog.js").ControlCatalog;
}

export interface BoardSubscription {
  readonly unsubscribe: () => import("effect").Effect.Effect<void>;
}

export interface ArtifactSubscription {
  readonly unsubscribe: () => import("effect").Effect.Effect<void>;
}

export interface ControlBus {
  readonly readPanel: (options?: {
    readonly includeCatalog?: boolean;
  }) => import("effect").Effect.Effect<ControlPanel, import("@livestreak/core").LiveStreakError>;
  readonly readBoard: () => import("effect").Effect.Effect<
    import("#run/control/board/index.js").Board,
    import("@livestreak/core").LiveStreakError
  >;
  readonly readCatalog: () => import("effect").Effect.Effect<
    import("#run/control/catalog.js").ControlCatalog,
    import("@livestreak/core").LiveStreakError
  >;
  readonly callFunction: (
    envelope: ControlCallEnvelope
  ) => import("effect").Effect.Effect<ControlCallResult, import("@livestreak/core").LiveStreakError>;
  readonly getArtifact: (
    id: string
  ) => import("effect").Effect.Effect<
    ControlArtifact | undefined,
    import("@livestreak/core").LiveStreakError
  >;
  readonly subscribeBoard: (
    listener: (board: import("#run/control/board/index.js").Board) => void
  ) => import("effect").Effect.Effect<BoardSubscription, import("@livestreak/core").LiveStreakError>;
  readonly subscribeArtifacts: (
    listener: (artifact: ControlArtifact) => void
  ) => import("effect").Effect.Effect<
    ArtifactSubscription,
    import("@livestreak/core").LiveStreakError
  >;
  readonly mountSurface: (
    surface: ControlSurface
  ) => import("effect").Effect.Effect<void, import("@livestreak/core").LiveStreakError>;
  readonly applyBoardPatch: (
    patch: BoardPatch
  ) => import("effect").Effect.Effect<
    { readonly board: import("#run/control/board/index.js").Board; readonly changed: boolean },
    import("@livestreak/core").LiveStreakError
  >;
  readonly commitBoard: (
    nextBoard: import("#run/control/board/index.js").Board
  ) => import("effect").Effect.Effect<
    import("#run/control/board/index.js").Board,
    import("@livestreak/core").LiveStreakError
  >;
  readonly registerWakeWorker: (
    wakeWorker: () => import("effect").Effect.Effect<void>
  ) => import("effect").Effect.Effect<void>;
}

export interface CreateControlBusInput {
  readonly runId: string;
  readonly board: import("#run/control/board/index.js").Board;
  readonly catalog: import("#run/control/catalog.js").ControlCatalog;
  readonly surfaces?: readonly ControlSurface[];
  readonly wakeWorker?: () => import("effect").Effect.Effect<void>;
}
