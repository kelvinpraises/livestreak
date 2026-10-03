import type { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
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
  /** The cell this call was matched to. Implementations patch THIS id, never a literal —
   *  one catalog serves every family (obs:<id>:run …). */
  readonly cellId: string;
  /** Persist a scoped external-submission checkpoint through the same guarded commit path. */
  readonly checkpoint?: (patch: BoardPatch) => Effect.Effect<void, LiveStreakError>;
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

/**
 * An execution lease binds one running observation execution to a monotonically advancing
 * generation token. Tokens advance on every reserve AND every release, so a write carrying
 * an old token can never match a live or future generation. Tokens stay internal — never
 * producer config, never an authorization credential.
 */
export interface ExecutionLease {
  readonly obsKey: string;
  readonly token: number;
}

/** Protected phase of one observation's admission entry. Stopping is part of executing: the
 *  lease is retained through awaited resource cleanup and terminal publication. */
export type ExecutionPhase = "inactive" | "configuring" | "preparing" | "executing";

/**
 * Per-observation admission gate plus generation owner (see bus/execution.ts). One instance
 * per control bus; observations are keyed independently so siblings never block each other.
 * Every acquire AND every release advances the token atomically, so ABA reuse is impossible.
 */
export interface ExecutionOwner {
  /** Reserve execution; fails unless the entry is inactive (atomic check-and-set). */
  readonly reserve: (
    obsKey: string
  ) => import("effect").Effect.Effect<number, import("@livestreak/core").LiveStreakError>;
  /** Claim an operator configuration interval; fails unless inactive (atomic). */
  readonly claimConfig: (
    obsKey: string
  ) => import("effect").Effect.Effect<number, import("@livestreak/core").LiveStreakError>;
  /** Claim a preparation interval (creates the entry for brand-new families); atomic. */
  readonly claimPrepare: (
    obsKey: string
  ) => import("effect").Effect.Effect<number, import("@livestreak/core").LiveStreakError>;
  /** Release a claim/reservation; only the matching token retires it (stale releases no-op). */
  readonly release: (
    obsKey: string,
    token: number
  ) => import("effect").Effect.Effect<void>;
  /** Snapshot {token, phase} for ExpectedGeneration tickets: no claim, no bump. */
  readonly readEntry: (obsKey: string) => import("effect").Effect.Effect<
    { readonly token: number; readonly phase: ExecutionPhase },
    never
  >;
  /** True when the token is the observation's current generation. */
  readonly isCurrent: (obsKey: string, token: number) => import("effect").Effect.Effect<boolean>;
  /** True while any protected phase owns the observation (configuring/preparing/executing). */
  readonly isActive: (obsKey: string) => import("effect").Effect.Effect<boolean>;
  /** True while ANY observation (family or legacy bare key) holds a protected phase. */
  readonly anyOwned: () => import("effect").Effect.Effect<boolean>;
}

/**
 * Authority for one guarded board transaction. OwnerLease = a held configuring/preparing/
 * executing token (nested internal work reuses the holder's token, never reserves twice).
 * ExpectedTicket = generation read at entry without claiming (pause/market lifecycle, handle-less
 * stop): any reserve/retire since capture makes the commit stale, even back to inactive.
 * SessionClearance = session add/remove/close, whose rules are checked atomically at commit.
 * Tokens are internal consistency facts, never client-supplied credentials.
 */
export type UpdateAuthority =
  | { readonly kind: "owner"; readonly lease: ExecutionLease }
  | { readonly kind: "ticket"; readonly ticket: ExecutionLease }
  | { readonly kind: "session" };

/**
 * What a guarded board update is allowed to change. Snapshot/lifecycle updates are derived
 * from the current board inside the guard (never a stale caller board). Call updates carry the
 * invoked scope/target so the return footprint is enforced against the operation table.
 */
export type UpdateOperation =
  | { readonly kind: "snapshot"; readonly obsId?: string }
  | { readonly kind: "lifecycle"; readonly obsId?: string }
  | {
      readonly kind: "call";
      readonly scope: string;
      readonly targetCell?: string;
      readonly obsId?: string;
      /** Surface patch cell keys (pre-derivation intent) for footprint validation. */
      readonly patchCellIds: ReadonlyArray<string>;
      readonly payload?: unknown;
    }
  | { readonly kind: "sessionAdd" }
  | { readonly kind: "sessionRemove"; readonly obsId: string }
  | { readonly kind: "sessionClose" }
  | { readonly kind: "prepareMeta"; readonly obsId: string };

/** Board wake fan-out subscription: lifetime-bound, unregistered on release. */
export interface WakeSubscription {
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
  /** Mount a driver's stage cell over an existing cell id WITHOUT shadowing it: the mounted
   *  surface inherits the existing surface's function entries (and the cell keeps its advertised
   *  functions) so configurators stay callable after prepare. */
  readonly mountStageCell: (
    definition: ControlCellDefinition
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
  /**
   * Guarded board transaction: authority check (owner lease / expected ticket / session rules)
   * plus return-footprint validation plus board rebase/commit happen atomically under the bus's
   * short transaction guard. The update derives from the CURRENT board inside the guard — never
   * a stale caller board. Notifications fire after commit with the committed receipt.
   */
  readonly commitGuardedUpdate: (
    authority: UpdateAuthority,
    operation: UpdateOperation,
    update: (
      current: import("#run/control/board/index.js").Board
    ) => import("effect").Effect.Effect<
      import("#run/control/board/index.js").Board,
      import("@livestreak/core").LiveStreakError
    >
  ) => import("effect").Effect.Effect<
    import("#run/control/board/index.js").Board,
    import("@livestreak/core").LiveStreakError
  >;
  /**
   * Dispatch with explicit authority (nested internal work reuses a held token; stop uses its
   * handle lease). Same validated route, admission, footprint and guarded commit as callFunction.
   */
  readonly dispatchCall: (
    envelope: ControlCallEnvelope,
    authority?: UpdateAuthority
  ) => import("effect").Effect.Effect<ControlCallResult, import("@livestreak/core").LiveStreakError>;
  /** Per-observation admission/lease owner for this bus. */
  readonly execution: ExecutionOwner;
  /**
   * Lifetime-bound wake subscription: additive fan-out, never replacement. Returns the
   * subscription — the caller unsubscribes on release. Callers that ignore the receipt stay
   * subscribed (documented behavior, not a leak in short-lived tests).
   */
  readonly registerWakeWorker: (
    wakeWorker: () => import("effect").Effect.Effect<void, import("@livestreak/core").LiveStreakError, never>
  ) => import("effect").Effect.Effect<WakeSubscription, never>;
}

export interface CreateControlBusInput {
  readonly runId: string;
  readonly board: import("#run/control/board/index.js").Board;
  readonly catalog: import("#run/control/catalog.js").ControlCatalog;
  readonly surfaces?: readonly ControlSurface[];
  readonly wakeWorker?: () => import("effect").Effect.Effect<void, import("@livestreak/core").LiveStreakError, never>;
}
