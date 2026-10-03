import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { Board } from "#run/control/board/index.js";
import { boardSettingsChanged, runCellIdOf } from "#run/control/board/index.js";
import { defaultControlPause, defaultControlRun } from "#run/control/board/settings.js";
import { validateBoardSettings } from "#run/control/board/index.js";
import { findCatalogFunctionByScope } from "#run/control/catalog.js";
import type { ControlCatalog } from "#run/control/catalog.js";
import { applyBoardPatch } from "#run/control/board/index.js";
import type { BoardCellPatch, BoardPatch } from "#run/control/bus/types.js";
import type { ControlArtifact, ControlCallEnvelope, ControlCallResult } from "#run/control/bus/calls.js";
import { cellIdForScope } from "#run/control/bus/calls.js";
import { createOpaqueArtifactId } from "./artifacts.js";
import { mergeBoardCellOnSurfaceMount } from "./mount.js";
import {
  buildSurfaceFunctionIndex,
  findSurfaceFunction,
  mountSurfaceRegistry
} from "./registry.js";
import {
  createArtifactSubscriptionRegistry,
  createBoardSubscriptionRegistry,
  createWakeSubscriptionRegistry
} from "./subscriptions.js";
import { createExecutionOwner } from "./execution.js";
import {
  captureKindCatalog,
  MAX_OBSERVATIONS,
  observationCellId,
  observationIdOf,
  publishKindCatalog,
  readObservationIndex,
  systemConfigCaptureKindScope,
  systemConfigCloseScope,
  systemConfigConfigureScope,
  systemConfigPublishKindScope,
  systemConfigRemoveScope
} from "#run/control/system/config.js";
import type {
  ControlBus,
  ControlFunctionEntry,
  ControlFunctionResult,
  ControlSurface,
  CreateControlBusInput,
  ExecutionLease,
  UpdateAuthority,
  UpdateOperation
} from "./types.js";
import {
  systemRunAwaitScope,
  systemRunPrepareScope,
  systemRunStartScope
} from "#run/control/index.js";

export const createControlBus = (
  input: CreateControlBusInput
): Effect.Effect<ControlBus, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const runId = input.runId;
    let surfaces: readonly ControlSurface[] = [];
    let functionIndex = yield* buildSurfaceFunctionIndex([]);
    let board = input.board;
    const catalog = input.catalog;
    const artifacts = new Map<string, ControlArtifact>();
    const boardSubscriptions = createBoardSubscriptionRegistry();
    const artifactSubscriptions = createArtifactSubscriptionRegistry();
    const wakeSubscriptions = createWakeSubscriptionRegistry();
    const execution = yield* createExecutionOwner();
    // The shared owner/write guard lives in the admission owner: every transition and every
    // board check/rebase/commit takes it. Guarded sections are pure-CPU only (never surface
    // invocation, chain, attach, callbacks or cleanup) and never nest a public owner op —
    // combined sections use readEntriesSnapshot plus pure checks inside one acquisition.
    if (input.wakeWorker !== undefined) {
      wakeSubscriptions.subscribe(input.wakeWorker);
    }

    const notifyCommitted = (committed: Board): Effect.Effect<void> =>
      Effect.gen(function* () {
        boardSubscriptions.notify(committed);
        yield* wakeSubscriptions.notifyAll();
      });

    const initialSurfaces = input.surfaces ?? [];

    if (initialSurfaces.length > 0) {
      yield* buildSurfaceFunctionIndex(initialSurfaces);
    }

    for (const surface of initialSurfaces) {
      surfaces = yield* mountSurfaceRegistry(surfaces, surface);
      const mergeResult = mergeBoardCellOnSurfaceMount(board, surface.cell);
      board = mergeResult.board;
    }

    functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

    const applyPatch = (
      patch: BoardPatch
    ): Effect.Effect<{ readonly board: Board; readonly changed: boolean }, LiveStreakError> =>
      Effect.gen(function* () {
        const committed = yield* execution.transact(
          Effect.gen(function* () {
            const result = yield* applyBoardPatch(board, patch);
            board = result.board;
            return result;
          })
        );
        if (committed.changed) {
          yield* notifyCommitted(committed.board);
        }
        return committed;
      });

    const commitBoardInternal = (
      nextBoard: Board,
      validateSettings: boolean
    ): Effect.Effect<Board, LiveStreakConfigError> =>
      Effect.gen(function* () {
        const committed = yield* execution.transact(
          Effect.gen(function* () {
            // Legacy newer-wins primitive (an accepted test pins silent stale no-op): all
            // production writers use guarded updater ops; snapshots can never drop here.
            // Unchanged commits suppress notifications entirely.
            if (nextBoard.revision <= board.revision) {
              return { board, changed: false };
            }

            // Shape-only on live writes: the ≥1-sink-policy COMPLETENESS rule is a go-live prerequisite, not a
            // per-write invariant. Enforcing it here would trap the operator configuring cells one at a time
            // (configure capture before sink → "At least one sink policy is required"). Prepare/kernel re-run
            // this with the completeness check (requireComplete defaults true).
            if (validateSettings && boardSettingsChanged(board, nextBoard)) {
              yield* validateBoardSettings(nextBoard, { requireComplete: false });
            }

            board = nextBoard;
            return { board, changed: true };
          })
        );
        if (committed.changed) {
          yield* notifyCommitted(committed.board);
        }
        return committed.board;
      });

    // Named guarded transaction: authority check + return-footprint validation + board
    // rebase/commit share the short guard atomically. The update derives from the CURRENT
    // board inside the guard — callers never certify stale whole-board objects.
    const commitGuardedUpdate = (
      authority: UpdateAuthority,
      operation: UpdateOperation,
      update: (current: Board) => Effect.Effect<Board, LiveStreakError>
    ): Effect.Effect<Board, LiveStreakError> =>
      Effect.gen(function* () {
        const committed = yield* execution.transact(
          Effect.gen(function* () {
            const entries = yield* execution.readEntriesSnapshot();
            yield* checkAuthorityPure(entries, authority, operation, operationFamilyKey(runId, operation));
            const current = board;
            const nextBoard = yield* update(current);
            yield* validateUpdateFootprint(operation, current, nextBoard);
            if (boardSettingsChanged(current, nextBoard)) {
              yield* validateBoardSettings(nextBoard, { requireComplete: false });
            }
            const changed = nextBoard !== current;
            board =
              changed && nextBoard.revision <= current.revision
                ? { ...nextBoard, revision: current.revision + 1 }
                : nextBoard;
            return { board, changed };
          })
        );
        if (committed.changed) {
          yield* notifyCommitted(committed.board);
        }
        return committed.board;
      });

    // Artifact persistence splits in two: makeArtifactDraft stores inside the guard (atomic
    // with the commit); consumer notification leaves the guard with the board receipt.
    const makeArtifactDraft = (draft: NonNullable<ControlFunctionResult["artifact"]>): ControlArtifact => {
      const artifact: ControlArtifact = {
        id: createOpaqueArtifactId(),
        kind: draft.kind,
        ownerCell: draft.ownerCell,
        function: draft.function,
        createdAtMs: draft.createdAtMs,
        ...(draft.expiresAtMs === undefined ? {} : { expiresAtMs: draft.expiresAtMs }),
        payload: draft.payload
      };

      artifacts.set(artifact.id, artifact);
      return artifact;
    };

    // Dispatch plan: which ownership the call needs and which footprint its result must fit.
    // Config-class mutations (capture/publish configure+close, kind switches, market close,
    // family removal) CLAIM the affected observation (atomic; refused while protected) and hold
    // through commit. Lifecycle calls (stop/pause/market go-live/register) take a ticket
    // (generation read, no claim) so they stay callable during execution but go stale on any
    // reserve/retire. Session add/close/remove use per-commit session rules.
    type DispatchPlan =
      | { readonly kind: "config"; readonly obsKey: string }
      | { readonly kind: "ticketed"; readonly obsKey?: string | undefined }
      | { readonly kind: "sessionAdd" }
      | { readonly kind: "sessionRemove"; readonly obsKey: string }
      | { readonly kind: "sessionClose" };

    const classifyDispatch = (
      envelope: ControlCallEnvelope,
      targetCell: string,
      authority: UpdateAuthority | undefined
    ): Effect.Effect<DispatchPlan, LiveStreakError> =>
      Effect.gen(function* () {
        const fnName = envelope.scope.split(":").at(-1) ?? "";
        const removeObsId = (): Effect.Effect<string, LiveStreakError> => {
          const obsId = readPayloadObsId(envelope.payload);
          return obsId === undefined
            ? Effect.fail(
                new LiveStreakConfigError({ message: "system:config:remove requires obsId" })
              )
            : Effect.succeed(obsId);
        };
        if (envelope.scope === systemConfigCloseScope) {
          return { kind: "sessionClose" } as const;
        }
        if (envelope.scope === systemConfigConfigureScope) {
          return { kind: "sessionAdd" } as const;
        }
        if (envelope.scope === systemConfigRemoveScope) {
          return { kind: "sessionRemove", obsKey: runKeyOf(yield* removeObsId()) } as const;
        }
        if (authority !== undefined) {
          // Nested internal work and handle-lease stop carry their own authority; the plan only
          // decides the footprint shape, never re-acquires.
          const obsId = observationIdOf(targetCell) ?? readPayloadObsId(envelope.payload);
          const obsKey = operationFamilyKey(runId, {kind:"call",scope:envelope.scope,targetCell,...(obsId === undefined ? {} : {obsId}),patchCellIds:[]});
          return { kind: "ticketed", ...(obsKey === undefined ? {} : { obsKey }) } as const;
        }
        // Config-class mutations claim the affected observation (atomic; refused while any
        // protected phase holds it): capture/publish configure+close, kind switches (payload
        // family), market register+close. Everything else takes a no-claim ticket.
        if (fnName === "captureKind" || fnName === "publishKind") {
          const obsId = readPayloadObsId(envelope.payload);
          if (obsId === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Scope ${envelope.scope} requires an observation obsId`
              })
            );
          }
          return { kind: "config", obsKey: runKeyOf(obsId) } as const;
        }
        // Market register establishes preparation input identity: direct registration claims
        // the inactive family (rejected before any registrar call while protected); nested
        // preparation registration reuses the preparing token via explicit authority above.
        // Market close and end require inactive ownership; goLive remains ticketed
        // live bookkeeping with identity preconditions at dispatch and commit.
        if (
          (fnName === "configure" || fnName === "close") &&
          (isFamilyPipelineCell(targetCell) ||
            isLegacyPipelineCell(targetCell) ||
            isMarketCellTarget(targetCell))
        ) {
          const obsId = observationIdOf(targetCell) ?? readPayloadObsId(envelope.payload);
          return { kind: "config", obsKey: runKeyOf(obsId) } as const;
        }
        if ((fnName === "register" || fnName === "setEnded") && isMarketCellTarget(targetCell)) {
          const obsId = observationIdOf(targetCell) ?? readPayloadObsId(envelope.payload);
          return { kind: "config", obsKey: runKeyOf(obsId) } as const;
        }
        const obsId = observationIdOf(targetCell) ?? readPayloadObsId(envelope.payload);
        const obsKey = operationFamilyKey(runId, {kind:"call",scope:envelope.scope,targetCell,...(obsId === undefined ? {} : {obsId}),patchCellIds:[]});
          return { kind: "ticketed", ...(obsKey === undefined ? {} : { obsKey }) } as const;
      });

    const runKeyOf = (obsId: string | undefined): string =>
      obsId === undefined ? runId : `${runId}#${obsId}`;

    // Admission capture shares ONE guard acquisition: owner transitions (claims) and
    // ticket/canonical-input reads happen together with nothing between them. Claims use
    // the raw in-transact primitive (never a public op — no nesting). Release runs later
    // outside the guard via the returned receipt (interruption-safe ensuring at the call).
    const acquireDispatchAuthority = (
      plan: DispatchPlan
    ): Effect.Effect<
      { authority: UpdateAuthority; release: Effect.Effect<void>; inputBoard: Board },
      LiveStreakError
    > =>
      execution.transact(
        Effect.gen(function* () {
          const inputBoard = board;
          switch (plan.kind) {
            case "config":
            case "sessionRemove": {
              const token = yield* execution.claimRaw(plan.obsKey, "configuring");
              const lease: ExecutionLease = { obsKey: plan.obsKey, token };
              return {
                authority: { kind: "owner", lease } as const,
                release: execution.release(plan.obsKey, token),
                inputBoard
              };
            }
            case "ticketed": {
              if (plan.obsKey === undefined) {
                // Session-global reads and legacy session calls carry no family generation.
                return {
                  authority: { kind: "session" } as const,
                  release: Effect.void,
                  inputBoard
                };
              }
              const entries = yield* execution.readEntriesSnapshot();
              const token = entries.get(plan.obsKey)?.token ?? 0;
              return {
                authority: {
                  kind: "ticket",
                  ticket: { obsKey: plan.obsKey, token }
                } as const,
                release: Effect.void,
                inputBoard
              };
            }
            case "sessionAdd": {
              // The new key is minted by the surface; claimed after invocation (see commit).
              return {
                authority: { kind: "session" } as const,
                release: Effect.void,
                inputBoard
              };
            }
            case "sessionClose": {
              return {
                authority: { kind: "session" } as const,
                release: Effect.void,
                inputBoard
              };
            }
          }
        })
      );

    // Validated dispatch: route → bind → admit/claim → invoke (outside guard) → guarded commit.
    // Nested internal work (prepare's registration) and stop (handle lease) pass explicit
    // authority; external calls acquire it here (claim for config mutations, ticket otherwise).
    const dispatchCall = (
      envelope: ControlCallEnvelope,
      authority: UpdateAuthority | undefined
    ): Effect.Effect<ControlCallResult, LiveStreakError> =>
      Effect.gen(function* () {
        if (envelope.runId !== runId) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Control call runId ${envelope.runId} does not match bus runId ${runId}`
            })
          );
        }

        const catalogFunction = findCatalogFunctionByScope(catalog, envelope.scope);
        if (catalogFunction === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Catalog does not advertise function scope ${envelope.scope}`
            })
          );
        }

        // Resolve the actual current target cell; a named cell must exist — fail closed.
        // Binding (catalog/scope/advertisement) is validated before any surface is selected,
        // so unknown/mismatched targets can never fall through to the canonical implementation.
        const targetCell = envelope.cellId ?? cellIdForScope(envelope.scope);
        const routingBoard = board;
        if (envelope.cellId !== undefined && routingBoard.cells[envelope.cellId] === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Unknown cell ${envelope.cellId} for scope ${envelope.scope}`
            })
          );
        }
        yield* validateDispatchBinding(
          catalog,
          routingBoard,
          targetCell,
          envelope.scope,
          envelope.cellId !== undefined
        );

        // Surface selection: a genuinely target-mounted implementation wins when it satisfies
        // the same binding; otherwise the validated canonical implementation serves the call
        // with the family target as context. No blind canonical escape remains.
        const direct = yield* findSurfaceFunction(functionIndex, targetCell, envelope.scope).pipe(
          Effect.option
        );
        const match =
          direct._tag === "Some"
            ? direct.value
            : yield* findSurfaceFunction(functionIndex, cellIdForScope(envelope.scope), envelope.scope);

        const plan = yield* classifyDispatch(envelope, targetCell, authority);
        if (plan.kind === "sessionClose") {
          return yield* commitSessionClose(envelope, targetCell, match, routingBoard);
        }

        // One acquire/use/release bracket: acquisition (claim/ticket + canonical input
        // board, sharing a single guard acquisition) and cleanup installation are atomic
        // under the outer mask; restore applies only to the body once cleanup exists, so a
        // failure or cancellation at any point after acquisition still releases. The
        // surface invocation runs outside the guard; the commit revalidates everything.
        // Explicit authority (nested/stop) skips acquisition and reads adjacent (its holder
        // already owns the generation; commit revalidates regardless).
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const held =
              authority !== undefined
                ? { authority, release: Effect.void, inputBoard: board }
                : yield* acquireDispatchAuthority(plan);
            return yield* restore(
              Effect.gen(function* () {
                const inputBoard = held.inputBoard;
                yield* checkDispatchPreconditions(plan, envelope, inputBoard);
            const result = yield* match.entry.call(envelope, {
              boardRevision: inputBoard.revision,
              board: inputBoard,
              cellId: targetCell,
              checkpoint: (boardPatch) => commitDispatchResult(
                plan, envelope, targetCell, inputBoard, { boardPatch }, held.authority
              ).pipe(Effect.asVoid)
            });
            return yield* commitDispatchResult(
              plan,
              envelope,
              targetCell,
              inputBoard,
              result,
              held.authority
            );
          })).pipe(Effect.ensuring(held.release));
          })
        );
      });

    // Dispatch-time semantic preconditions (fail fast before external/chain work). The same
    // checks run again at commit against the current board.
    const checkDispatchPreconditions = (
      plan: DispatchPlan,
      envelope: ControlCallEnvelope,
      inputBoard: Board
    ): Effect.Effect<void, LiveStreakError> =>
      Effect.gen(function* () {
        const fnName = envelope.scope.split(":").at(-1) ?? "";
        if (fnName === "start") {
          const targetCell = envelope.cellId ?? cellIdForScope(envelope.scope);
          const obsId = observationIdOf(targetCell);
          const marketCell = obsId === undefined ? "market" : `obs:${obsId}:market`;
          const market = inputBoard.cells[marketCell];
          const pending = market?.readonly?.endSubmission as { marketId?: string; hash?: string } | undefined;
          if (pending?.hash && pending.marketId === market?.readonly?.marketId) {
            return yield* Effect.fail(new LiveStreakConfigError({ message: "Confirm the pending stream end before broadcasting again." }));
          }
          if (market?.readonly?.registrationState === "ended" || market?.status[0] === "ended") {
            return yield* Effect.fail(new LiveStreakConfigError({ message: "This market has ended. Create a new observation to broadcast again." }));
          }
        }
        if (fnName === "goLive" || fnName === "setEnded") {
          yield* checkMarketLifecyclePrecondition(envelope, inputBoard);
        }
      });

    const checkMarketLifecyclePrecondition = (
      envelope: ControlCallEnvelope,
      inputBoard: Board
    ): Effect.Effect<void, LiveStreakError> =>
      Effect.gen(function* () {
        const fnName = envelope.scope.split(":").at(-1) ?? "";
        const targetCell = envelope.cellId ?? cellIdForScope(envelope.scope);
        const registered = inputBoard.cells[targetCell]?.readonly?.marketId;
        if (typeof registered !== "string" || !registered.startsWith("0x")) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Market ${fnName} requires marketId — none registered on ${targetCell}`
            })
          );
        }
        if (fnName === "setEnded") {
          const runCell = runCellIdOf(inputBoard, undefined, observationIdOf(targetCell));
          const status = runCell === undefined ? undefined : inputBoard.cells[runCell]?.status[0];
          if (status !== undefined && !["created", "prepared", "stopped", "failed"].includes(status)) {
            return yield* Effect.fail(new LiveStreakConfigError({
              message: "Stop the producer and wait for finalization before setting the market ended."
            }));
          }
        }
        const explicit = readPayloadMarketId(envelope.payload);
        if (explicit !== undefined && explicit !== registered) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Market ${fnName} payload marketId does not match registered ${registered}`
            })
          );
        }
      });

    // One current-state commit boundary for every effective mutation and artifact: binding
    // revalidation, footprint, market semantics, patch application and artifact
    // validation/storage share the guard atomically; notifications leave it afterwards.
    // Suppressed hook results are validated then discarded (response-only); an artifact
    // accompanying a suppressed patch requires the actual owning operation identity.
    const commitDispatchResult = (
      plan: DispatchPlan,
      envelope: ControlCallEnvelope,
      targetCell: string,
      inputBoard: Board,
      result: ControlFunctionResult,
      authority: UpdateAuthority
    ): Effect.Effect<ControlCallResult, LiveStreakError> =>
      Effect.gen(function* () {
        const fnName = envelope.scope.split(":").at(-1) ?? "";
        const obsId = observationIdOf(targetCell) ?? readPayloadObsId(envelope.payload);
        const suppressed = isSuppressedHookScope(envelope.scope);
        if (plan.kind === "sessionAdd" && result.boardPatch !== undefined) {
          if (result.artifact !== undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: "Session add must not produce an artifact"
              })
            );
          }
          const boardPatch = result.boardPatch;
          const changed = yield* commitSessionAdd(boardPatch, envelope.payload, envelope.scope, inputBoard);
          const fresh = board;
          return {
            callId: envelope.callId,
            runId,
            scope: envelope.scope,
            boardRevision: fresh.revision,
            changed,
            boardPatch
          } satisfies ControlCallResult;
        }
        if (plan.kind === "sessionRemove" && result.boardPatch !== undefined) {
          const removeObsId = readPayloadObsId(envelope.payload) ?? obsId;
          if (removeObsId === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({ message: "system:config:remove requires obsId" })
            );
          }
          if (result.artifact !== undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: "Session remove must not produce an artifact"
              })
            );
          }
          const boardPatch = result.boardPatch;
          const changed = yield* commitSessionRemove(boardPatch, removeObsId, authority, envelope.scope);
          const fresh = board;
          return {
            callId: envelope.callId,
            runId,
            scope: envelope.scope,
            boardRevision: fresh.revision,
            changed,
            boardPatch
          } satisfies ControlCallResult;
        }
        if (result.boardPatch !== undefined) {
          yield* validateKindPatchShape(envelope.scope, envelope.payload, result.boardPatch, obsId);
        }
        const patchCellIds = Object.keys(result.boardPatch?.cells ?? {});
        // Suppressed hook results are response-only: validated (binding, footprint, market
        // semantics) against a fresh board but never committed — a successfully completed
        // prepare/start must not fail merely because it legitimately advanced its own
        // entry token. An artifact with a suppressed patch still needs owning identity.
        if (suppressed && result.artifact === undefined) {
          const validationBoard = board;
          yield* validateDispatchBinding(
            catalog,
            validationBoard,
            targetCell,
            envelope.scope,
            envelope.cellId !== undefined
          );
          yield* validateCallPatchFootprint(
            envelope.scope,
            targetCell,
            obsId,
            envelope.payload,
            patchCellIds
          );
          const fresh = board;
          return {
            callId: envelope.callId,
            runId,
            scope: envelope.scope,
            boardRevision: fresh.revision,
            changed: false
          } satisfies ControlCallResult;
        }
        const operation: UpdateOperation = {
          kind: "call",
          scope: envelope.scope,
          targetCell,
          ...(obsId === undefined ? {} : { obsId }),
          patchCellIds,
          ...(envelope.payload === undefined ? {} : { payload: envelope.payload })
        };
        let storedArtifact: ControlArtifact | undefined;
        const after = yield* commitGuardedUpdate(authority, operation, (current) =>
          Effect.gen(function* () {
            // Revalidate the live target binding at commit: a capability surface changed
            // (or emptied) during the effect must not receive its stale result.
            yield* validateDispatchBinding(
              catalog,
              current,
              targetCell,
              envelope.scope,
              envelope.cellId !== undefined
            );
            if (result.boardPatch !== undefined) {
              yield* validateCallPatchFootprint(
                envelope.scope,
                targetCell,
                obsId,
                envelope.payload,
                patchCellIds
              );
            }
            let next = current;
            if (result.boardPatch !== undefined && !suppressed) {
              next = (yield* applyBoardPatch(current, result.boardPatch)).board;
            }
            // Identity preservation merges before semantic validation, so the lifecycle
            // patch's unsets can never drop the registered stream identity.
            next = preserveMarketStreamIdentity(envelope.scope, current, next, targetCell);
            yield* validateCallCommitSemantics(operation, current, next);
            if (result.artifact !== undefined) {
              yield* validateArtifactOwner(result.artifact, fnName, targetCell);
              if (suppressed && authority.kind !== "owner") {
                return yield* Effect.fail(
                  new LiveStreakConfigError({
                    message:
                      `Artifact with suppressed ${envelope.scope} requires the owning operation identity`
                  })
                );
              }
              storedArtifact = makeArtifactDraft(result.artifact);
            }
            return next;
          })
        );
        if (storedArtifact !== undefined) {
          artifactSubscriptions.notify(storedArtifact);
        }
        const fresh = board;
        const artifactId = storedArtifact?.id;
        return {
          callId: envelope.callId,
          runId,
          scope: envelope.scope,
          boardRevision: fresh.revision,
          changed: after !== inputBoard,
          ...(artifactId === undefined ? {} : { artifactId }),
          ...(storedArtifact === undefined ? {} : { artifact: storedArtifact }),
          ...(!suppressed && result.boardPatch !== undefined ? { boardPatch: result.boardPatch } : {})
        } satisfies ControlCallResult;
      });

    const isSuppressedHookScope = (scope: string): boolean =>
      scope === systemRunPrepareScope || scope === systemRunStartScope || scope === systemRunAwaitScope;

    // Artifact binds to the invoked operation's target exactly — not to every sibling cell
    // sharing an obsId (a capture configure cannot assign an artifact to its market cell).
    const validateArtifactOwner = (
      artifact: NonNullable<ControlFunctionResult["artifact"]>,
      fnName: string,
      targetCell: string
    ): Effect.Effect<void, LiveStreakError> =>
      Effect.gen(function* () {
        if (artifact.ownerCell !== targetCell || artifact.function !== fnName) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message:
                `Artifact from ${targetCell} names foreign owner ${artifact.ownerCell} ` +
                `(function ${artifact.function}, expected ${fnName})`
            })
          );
        }
      });

    // Session add: rebase the new family onto the CURRENT index inside the guard (never the
    // surface's stale full object), preserving siblings added meanwhile. Limit enforced
    // against current state. The preparation claim is acquired BEFORE the transaction (never
    // nested inside it) with interruption-safe release on every exit.
    // Session add: claim the fresh family BEFORE the transaction (never nested inside
    // it) with interruption-safe release on every exit. One acquire/use/release bracket
    // shares the outer mask atomically; restore applies only to the commit body once
    // cleanup exists. The commit revalidates everything against the CURRENT board (not the
    // dispatch-time adjacent): machine cells created by a concurrently added sibling are
    // preserved (dropped from the rebased patch), never replaced; the index merges the new
    // entry onto the current index. A surface that mutates an unrelated index entry is
    // rejected, not silently discarded.
    const commitSessionAdd = (
      patch: BoardPatch,
      payload: unknown,
      scope: string,
      inputBoard: Board
    ): Effect.Effect<boolean, LiveStreakError> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const candidateKeys = listCreatedFamilyKeys(patch, board);
          if (candidateKeys.length !== 1 || candidateKeys[0] === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: "Session add must create exactly one fresh observation family"
              })
            );
          }
          const candidateKey = candidateKeys[0];
          const originalIndex = readObservationIndex(inputBoard);
          const returnedIndex = readPatchIndex(patch);
          const expectedKeys = new Set([...Object.keys(originalIndex), candidateKey]);
          if (
            Object.keys(returnedIndex).length !== expectedKeys.size ||
            Object.keys(returnedIndex).some((key) => !expectedKeys.has(key)) ||
            Object.entries(originalIndex).some(([key, value]) =>
              !deepEqualBirth(returnedIndex[key], value)
            )
          ) {
            return yield* Effect.fail(new LiveStreakConfigError({
              message: "Session add must return the original index plus exactly its new entry"
            }));
          }
          yield* validateSessionAddFootprint(patch, inputBoard, candidateKey);
          yield* validateSessionBirthContract(patch, payload, inputBoard, candidateKey);
          const claimed = yield* execution.claimPrepare(runKeyOf(candidateKey));
          let appliedChanged = false;
          yield* restore(
            Effect.gen(function* () {
              const committed = yield* commitGuardedUpdate(
                { kind: "session" },
                { kind: "sessionAdd" },
                (current) =>
                  Effect.gen(function* () {
                    const currentIndex = readObservationIndex(current);
                    if (Object.keys(currentIndex).length >= MAX_OBSERVATIONS) {
                      return yield* Effect.fail(
                        new LiveStreakConfigError({
                          message: `Session holds ${MAX_OBSERVATIONS} observations already — remove one first`
                        })
                      );
                    }
                    const newKeys = listCreatedFamilyKeys(patch, current);
                    if (newKeys.length !== 1 || newKeys[0] !== candidateKey) {
                      return yield* Effect.fail(
                        new LiveStreakConfigError({
                          message: "Session add family changed during commit — retry the add"
                        })
                      );
                    }
                    const newKey = newKeys[0];
                    if (currentIndex[newKey] !== undefined) {
                      return yield* Effect.fail(
                        new LiveStreakConfigError({
                          message: `Session add collides with existing observation ${newKey}`
                        })
                      );
                    }
                    yield* validateDispatchBinding(catalog, current, "system:config", scope, false);
                    const patchIndex = readPatchIndex(patch);
                    const entry = patchIndex[newKey];
                    // Machine cells created by a concurrently added sibling are preserved,
                    // never replaced: drop already-present machine creates from the rebased
                    // patch before footprint validation.
                    const rebasedCells: Record<string, BoardCellPatch | undefined> = {
                      ...patch.cells
                    };
                    for (const machineId of ["system:memory", "system:tick"] as const) {
                      if (current.cells[machineId] !== undefined) {
                        delete rebasedCells[machineId];
                      }
                    }
                    const rebased: BoardPatch = {
                      cells: {
                        ...rebasedCells,
                        "system:config": {
                          ...(patch.cells?.["system:config"] ?? {}),
                          readonly: {
                            ...(patch.cells?.["system:config"]?.readonly ?? {}),
                            set: {
                              ...((patch.cells?.["system:config"]?.readonly as { set?: Record<string, unknown> } | undefined)?.set ?? {}),
                              observations: { ...currentIndex, [newKey]: entry }
                            }
                          }
                        }
                      }
                    };
                    yield* validateSessionAddFootprint(rebased, current, newKey);
                    yield* validateSessionBirthContract(patch, payload, current, newKey);
                    const applied = yield* applyBoardPatch(current, rebased);
                    appliedChanged = applied.changed;
                    return applied.board;
                  })
              );
              void committed;
            })
          ).pipe(Effect.ensuring(execution.release(runKeyOf(candidateKey), claimed)));
          return appliedChanged;
        })
      );

    // Session remove: claim held since dispatch; rebased removals apply idempotently onto the
    // current board (entry gone if present, cells gone if present), preserving siblings.
    const commitSessionRemove = (
      patch: BoardPatch,
      obsId: string,
      authority: UpdateAuthority,
      scope: string
    ): Effect.Effect<boolean, LiveStreakError> =>
      Effect.gen(function* () {
        let appliedChanged = false;
        yield* commitGuardedUpdate(authority, { kind: "sessionRemove", obsId }, (current) =>
          Effect.gen(function* () {
            yield* validateDispatchBinding(catalog, current, "system:config", scope, false);
            yield* validateSessionRemoveFootprint(patch, current, obsId);
          const currentIndex = readObservationIndex(current);
            const rebased: BoardPatch = {
              cells: {
                ...patch.cells,
                "system:config": {
                  ...(patch.cells?.["system:config"] ?? {}),
                  readonly: {
                    ...(patch.cells?.["system:config"]?.readonly ?? {}),
                    set: {
                      ...((patch.cells?.["system:config"]?.readonly as { set?: Record<string, unknown> } | undefined)?.set ?? {}),
                      observations: Object.fromEntries(
                        Object.entries(currentIndex).filter(([key]) => key !== obsId)
                      )
                    }
                  }
                }
              }
            };
            const applied = yield* applyBoardPatch(current, rebased);
            appliedChanged = applied.changed;
            return applied.board;
          })
        );
        return appliedChanged;
      });

    // Session close: check (no protected owner anywhere) and deletion in one short guarded
    // transaction. A concurrent cell-set/index change since invocation is a truthful conflict.
    const commitSessionClose = (
      envelope: ControlCallEnvelope,
      targetCell: string,
      match: { entry: ControlFunctionEntry },
      baseBoard: Board
    ): Effect.Effect<ControlCallResult, LiveStreakError> =>
      Effect.gen(function* () {
        const inputBoard = board;
        const result = yield* match.entry.call(envelope, {
          boardRevision: inputBoard.revision,
          board: inputBoard,
          cellId: targetCell
        });
        if (result.boardPatch === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({ message: "Session close produced no teardown patch" })
          );
        }
        // Session close tears down; it never issues artifacts (only session add and
        // family remove do). An artifact here is a surface defect — reject before teardown.
        if (result.artifact !== undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: "Session close must not issue an artifact"
            })
          );
        }
        const patch = result.boardPatch;
        const baseIds = new Set(Object.keys(baseBoard.cells));
        const baseIndex = JSON.stringify(readObservationIndex(baseBoard));
        const committed = yield* commitGuardedUpdate(
          { kind: "session" },
          { kind: "sessionClose" },
          (current) =>
            Effect.gen(function* () {
              const snapshot = yield* execution.readEntriesSnapshot();
              if ([...snapshot.values()].some((entry) => entry.phase !== "inactive")) {
                return yield* Effect.fail(
                  new LiveStreakConfigError({
                    message: "Session close refused while an observation holds a protected phase"
                  })
                );
              }
              const currentIds = new Set(Object.keys(current.cells));
              const sameIds =
                baseIds.size === currentIds.size &&
                [...baseIds].every((id) => currentIds.has(id));
              if (!sameIds || JSON.stringify(readObservationIndex(current)) !== baseIndex) {
                return yield* Effect.fail(
                  new LiveStreakConfigError({
                    message: "Session changed during close — retry the close"
                  })
                );
              }
              yield* validateDispatchBinding(
                catalog,
                current,
                "system:config",
                envelope.scope,
                false
              );
              yield* validateSessionCloseFootprint(patch, current);
              return (yield* applyBoardPatch(current, patch)).board;
            })
        );
        const fresh = board;
        return {
          callId: envelope.callId,
          runId,
          scope: envelope.scope,
          boardRevision: fresh.revision,
          changed: committed !== inputBoard,
          boardPatch: patch
        } satisfies ControlCallResult;
      });

    const bus: ControlBus = {
      readPanel: (options) =>
        Effect.sync(() => ({
          board,
          ...(options?.includeCatalog === true ? { catalog } : {})
        })),

      readBoard: () => Effect.sync(() => board),

      readCatalog: () => Effect.succeed(catalog),

      getArtifact: (id) => Effect.sync(() => artifacts.get(id)),

      subscribeBoard: (listener) =>
        Effect.sync(() => boardSubscriptions.subscribe(listener)),

      subscribeArtifacts: (listener) =>
        Effect.sync(() => artifactSubscriptions.subscribe(listener)),

      mountSurface: (surface) =>
        Effect.gen(function* () {
          const committed = yield* execution.transact(
            Effect.gen(function* () {
              surfaces = yield* mountSurfaceRegistry(surfaces, surface);
              functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

              const mergeResult = mergeBoardCellOnSurfaceMount(board, surface.cell);
              board = mergeResult.board;
              return mergeResult;
            })
          );
          if (committed.changed) {
            yield* notifyCommitted(committed.board);
          }
        }),

      mountStageCell: (definition) =>
        Effect.gen(function* () {
          const existing = surfaces.find((entry) => entry.cell.id === definition.id);
          // A stage cell carries state, not capabilities: functions (both the callable entries
          // and the cell's advertised list) stay with whatever configurator surface already owns
          // this cell id — a prepared run must remain reconfigurable.
          const cell =
            definition.cell.functions.length === 0 && existing !== undefined
              ? { ...definition.cell, functions: existing.cell.cell.functions }
              : definition.cell;
          const surface: ControlSurface = {
            cell: { id: definition.id, cell },
            functions: existing?.functions ?? []
          };

          surfaces = yield* mountSurfaceRegistry(surfaces, surface);
          functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

          const committed = yield* execution.transact(
            Effect.gen(function* () {
              surfaces = yield* mountSurfaceRegistry(surfaces, surface);
              functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

              const mergeResult = mergeBoardCellOnSurfaceMount(board, surface.cell, {
                allowCreate: true
              });
              board = mergeResult.board;
              return mergeResult;
            })
          );
          if (committed.changed) {
            yield* notifyCommitted(committed.board);
          }
        }),

      applyBoardPatch: (patch) => applyPatch(patch),

      commitBoard: (nextBoard) => commitBoardInternal(nextBoard, true),

      commitGuardedUpdate: (authority, operation, update) =>
        commitGuardedUpdate(authority, operation, update),

      execution: {
        reserve: execution.reserve,
        claimConfig: execution.claimConfig,
        claimPrepare: execution.claimPrepare,
        release: execution.release,
        readEntry: execution.readEntry,
        isCurrent: execution.isCurrent,
        isActive: execution.isActive,
        anyOwned: execution.anyOwned
      },

      // Lifetime-bound wake subscription: starting a worker never replaces (and stopping
      // never silences) a sibling's wake. The caller unsubscribes on release; retained for
      // kernel/tests that ignore the receipt, which simply stay subscribed.
      registerWakeWorker: (wake) => Effect.sync(() => wakeSubscriptions.subscribe(wake)),

      callFunction: (envelope) => dispatchCall(envelope, undefined),

      dispatchCall: (envelope, authority) => dispatchCall(envelope, authority)
    };

    return bus;
  });

export const assertCatalogFunctionAdvertised = (
  catalog: ControlCatalog,
  scope: string
): Effect.Effect<void, LiveStreakConfigError> =>
  findCatalogFunctionByScope(catalog, scope) === undefined
    ? Effect.fail(
        new LiveStreakConfigError({
          message: `Catalog does not advertise function scope ${scope}`
        })
      )
    : Effect.void;

/** Specifically recognized stale-owner rejection (narrow catchAll targets this only). */
export const STALE_OWNER_MESSAGE = "Stale owner write for";

export const isStaleOwnerError = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).startsWith(STALE_OWNER_MESSAGE);
  }
  return String(error).includes(STALE_OWNER_MESSAGE);
};

const staleOwnerFail = (obsKey: string): Effect.Effect<never, LiveStreakConfigError> =>
  Effect.fail(
    new LiveStreakConfigError({
      message: `${STALE_OWNER_MESSAGE} ${obsKey}: generation advanced`
    })
  );

/**
 * Authority check against a peeked snapshot (call inside transact only): owner and ticket
 * kinds require token equality AND key binding — an A lease can never certify a B write.
 * Owner authority additionally requires the entry's protected phase to admit the
 * operation (snapshots execute; lifecycle prepares or executes; calls hold a claimed
 * phase; removal holds configuring). Any reserve/retire since capture makes the commit
 * stale, even back to inactive. Session authority carries no token; its per-operation
 * rules are enforced at commit.
 */
const OWNER_SNAPSHOT_PHASES: ReadonlySet<string> = new Set(["executing"]);
const OWNER_PREPAREMETA_PHASES: ReadonlySet<string> = new Set(["preparing"]);
const OWNER_LIFECYCLE_PHASES: ReadonlySet<string> = new Set(["preparing", "executing"]);
const OWNER_CALL_PHASES: ReadonlySet<string> = new Set([
  "configuring",
  "preparing",
  "executing"
]);
const checkAuthorityPure = (
  entries: ReadonlyMap<string, { readonly token: number; readonly phase: string }>,
  authority: UpdateAuthority,
  operation: UpdateOperation,
  expectedKey: string | undefined
): Effect.Effect<void, LiveStreakError> => {
  if (authority.kind === "session") {
    // Session clearance authorizes only session add/close and genuinely session-global
    // call operations (no expected family key). Scoped snapshot/lifecycle/prepareMeta,
    // sessionRemove and any family (or bare-run keyed) call require an owner lease or a
    // generation ticket — session clearance is not a substitute for ownership. The guarded
    // bus exposes authority-taking primitives, so this contract holds regardless of which
    // internal caller supplies the authority.
    if (operation.kind === "sessionAdd" || operation.kind === "sessionClose") {
      return Effect.void;
    }
    if (operation.kind === "call" && expectedKey === undefined) {
      return Effect.void;
    }
    return staleOwnerFail("(session authority for scoped operation)");
  }
  // Tickets authorize operator calls and lifecycle reconciliation, never worker
  // snapshots, preparation metadata or removal, which require a phase-owning lease.
  if (authority.kind === "ticket" && operation.kind !== "call" && operation.kind !== "lifecycle") {
    return staleOwnerFail(authority.ticket.obsKey);
  }
  const { obsKey, token } = authority.kind === "owner" ? authority.lease : authority.ticket;
  if (expectedKey === undefined || obsKey !== expectedKey) {
    return staleOwnerFail(obsKey);
  }
  const entry = entries.get(obsKey);
  if (entry === undefined ? authority.kind !== "ticket" || token !== 0 : entry.token !== token) {
    return staleOwnerFail(obsKey);
  }
  // Tickets bind generation only (pause/market lifecycle stay callable while inactive).
  // Owner leases additionally bind the protected phase to the operation.
  if (authority.kind === "owner") {
    const allowed =
      operation.kind === "snapshot"
        ? OWNER_SNAPSHOT_PHASES
        : operation.kind === "lifecycle"
          ? OWNER_LIFECYCLE_PHASES
          : operation.kind === "sessionRemove"
            ? OWNER_CALL_PHASES
            : operation.kind === "prepareMeta"
              ? OWNER_PREPAREMETA_PHASES
              : OWNER_CALL_PHASES;
    if (entry === undefined || !allowed.has(entry.phase)) {
      return staleOwnerFail(obsKey);
    }
    if (operation.kind === "sessionRemove" && entry?.phase !== "configuring") {
      return staleOwnerFail(obsKey);
    }
  }
  return Effect.void;
};

const familyParts = (cellId: string): { obsId: string; kind: string } | undefined => {
  const parts = cellId.split(":");
  if (parts[0] !== "obs" || parts.length !== 3) {
    return undefined;
  }
  return { obsId: parts[1]!, kind: parts[2]! };
};

const isFamilyPipelineCell = (cellId: string): boolean => {
  const family = familyParts(cellId);
  return family !== undefined && (family.kind === "capture" || family.kind === "publish");
};

const isLegacyPipelineCell = (cellId: string): boolean =>
  cellId.startsWith("capture:") || cellId.startsWith("sink:");

const isMarketCellTarget = (cellId: string): boolean => {
  if (cellId === "market") {
    return true;
  }
  const family = familyParts(cellId);
  return family?.kind === "market";
};

/**
 * Validated dispatch binding: resolve the actual current target cell, require its known
 * catalog, require the scope to belong to that catalog, and require the function to be
 * explicitly advertised — an explicitly empty function list denies the call. Unknown
 * explicit targets/catalogs never fall through to the canonical implementation.
 */
const validateDispatchBinding = (
  catalog: ControlCatalog,
  board: Board,
  targetCell: string,
  scope: string,
  explicit: boolean
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const canonical = cellIdForScope(scope);
    if (catalog.cells[canonical] === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Unknown target catalog for scope ${scope}`
        })
      );
    }
    const boardCell = board.cells[targetCell];
    if (boardCell === undefined) {
      // Implicit (session/legacy) targets resolve through the canonical implementation.
      // An explicit target that vanished mid-flight is a conflict, not a fallback.
      if (explicit) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Unknown cell ${targetCell} for scope ${scope}`
          })
        );
      }
      return;
    }
    if (boardCell.catalog === undefined) {
      // Legacy untyped cells: only the canonical target itself may use them.
      if (explicit && targetCell !== canonical) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Unknown target catalog for cell ${targetCell} and scope ${scope}`
          })
        );
      }
      return;
    }
    if (boardCell.catalog !== canonical) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message:
            `Cell ${targetCell} serves catalog ${boardCell.catalog}, not ${canonical} — ` +
            "switch the cell kind before configuring it"
        })
      );
    }
    const fnName = scope.split(":").at(-1) ?? "";
    if (!Array.isArray(boardCell.functions) || !boardCell.functions.includes(fnName)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Cell ${targetCell} does not advertise function ${fnName}`
        })
      );
    }
  });

/**
 * Kind-switch field allowlist: a kind result may only carry the switch itself (catalog,
 * source stamp, kind/configured reset, idle status) on exactly the payload family's cell.
 * It cannot smuggle paths, ports, dimensions, transports or facts on the allowed cell.
 */
const KIND_CAPTURE_DETAIL_KEYS = new Set([
  "path",
  "maxPumpMs",
  "width",
  "height",
  "fps",
  "port",
  "byteFormat",
  "frameCount",
  "continuous", "streamName", "audio", "startupTimeoutMs", "idleTimeoutMs"
]);

const isFiniteTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validateKindPatchShape = (
  scope: string,
  payload: unknown,
  patch: BoardPatch,
  obsId: string | undefined
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fail = (why: string): Effect.Effect<never, LiveStreakError> =>
      Effect.fail(new LiveStreakConfigError({ message: `Kind switch rejected: ${why}` }));
    const record =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const payloadObsId = typeof record.obsId === "string" ? record.obsId.trim() : "";
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const isCapture = scope === systemConfigCaptureKindScope;
    const isPublish = scope === systemConfigPublishKindScope;
    if (!isCapture && !isPublish) {
      return;
    }
    if (payloadObsId === "" || (obsId !== undefined && payloadObsId !== obsId)) {
      return yield* fail("missing or mismatched observation");
    }
    const expectedCell = observationCellId(
      payloadObsId,
      isCapture ? "capture" : "publish"
    );
    const ids = Object.keys(patch.cells ?? {});
    if (ids.length !== 1 || ids[0] !== expectedCell) {
      return yield* fail("must touch exactly the payload family's cell");
    }
    const cellPatch = patch.cells?.[expectedCell];
    if (cellPatch === undefined || cellPatch.remove === true || cellPatch.create !== undefined) {
      return yield* fail("must patch (not remove or create) the family cell");
    }
    const expectedCatalog = isCapture ? captureKindCatalog(kind) : publishKindCatalog(kind);
    if (cellPatch.catalog !== expectedCatalog) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Kind switch rejected: catalog must be ${expectedCatalog}`
        })
      );
    }
    if (isCapture) {
      const settings = cellPatch.settings;
      const setKeys = Object.keys(settings?.set ?? {});
      if (setKeys.length !== 1 || (settings?.set as Record<string, unknown> | undefined)?.source !== kind) {
        return yield* fail("capture settings may only stamp source");
      }
      for (const key of settings?.unset ?? []) {
        if (!KIND_CAPTURE_DETAIL_KEYS.has(key)) {
          return yield* fail(`capture unset carries unexpected key ${key}`);
        }
      }
    } else if (cellPatch.settings !== undefined) {
      return yield* fail("publish switch carries no settings");
    }
    const readonlySet = (cellPatch.readonly?.set ?? {}) as Record<string, unknown>;
    const readonlyKeys = Object.keys(readonlySet);
    if (
      readonlyKeys.length !== 2 ||
      readonlySet.kind !== kind ||
      readonlySet.configured !== false
    ) {
      return yield* fail("readonly may only reset kind/configured");
    }
    // A kind switch resets kind/configured and stamps source — nothing else. Owner
    // unsets (obsId!), capability writes (functions), labels and refs all fail closed.
    if ((cellPatch.readonly?.unset ?? []).length !== 0) {
      return yield* fail("readonly carries no unsets on kind switch");
    }
    if (
      cellPatch.functions !== undefined ||
      cellPatch.label !== undefined ||
      cellPatch.refs !== undefined
    ) {
      return yield* fail("kind switch carries no functions, label or refs");
    }
    const status = cellPatch.status;
    if (
      !Array.isArray(status) ||
      status[0] !== "idle" ||
      status[1] !== null ||
      !isFiniteTimestamp(status[2])
    ) {
      return yield* fail("status must be idle with a finite timestamp");
    }
  });

const readPayloadMarketId = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const marketId = (payload as Record<string, unknown>).marketId;
  return typeof marketId === "string" && marketId.length > 0 ? marketId : undefined;
};

const readPayloadObsId = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const obsId = (payload as Record<string, unknown>).obsId;
  return typeof obsId === "string" && obsId.length > 0 ? obsId : undefined;
};

/** Family owner key an operation writes for (session ops have none — checked per rule).
 *  Legacy bare pipeline/run/pause/market targets bind the bare runId key. */
const operationFamilyKey = (runId: string, operation: UpdateOperation): string | undefined => {
  switch (operation.kind) {
    case "snapshot":
    case "lifecycle":
      return operation.obsId === undefined ? runId : `${runId}#${operation.obsId}`;
    case "call": {
      if (operation.obsId !== undefined) {
        return `${runId}#${operation.obsId}`;
      }
      const target = operation.targetCell ?? cellIdForScope(operation.scope);
      if (
        isLegacyPipelineCell(target) ||
        target === "system:run" ||
        target === "system:pause" ||
        target === "market"
      ) {
        return runId;
      }
      return undefined;
    }
    case "sessionAdd":
    case "sessionClose":
      return undefined;
    case "sessionRemove":
      return `${runId}#${operation.obsId}`;
    case "prepareMeta":
      return `${runId}#${operation.obsId}`;
  }
};

/** Cell ids whose value differs between two boards (immutable producers: reference change). */
const changedCellIds = (before: Board, after: Board): ReadonlySet<string> => {
  const changed = new Set<string>();
  const ids = new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
  for (const id of ids) {
    if (before.cells[id] !== after.cells[id]) {
      changed.add(id);
    }
  }
  return changed;
};

/**
 * Return-footprint enforcement at the write boundary: the committed board may only differ
 * in cells the operation is allowed to touch. Surface patch keys are checked before derivation;
 * the derived run-cell demotion is permitted as patch-layer derivation, not surface output.
 */
const validateUpdateFootprint = (
  operation: UpdateOperation,
  current: Board,
  next: Board
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const changed = changedCellIds(current, next);
    switch (operation.kind) {
      case "snapshot": {
        // Scoped (explicit obsId) snapshots touch only their family's run/capture/publish
        // cells — never legacy globals, siblings, or other families. Legacy snapshots (no
        // obsId) use the run cell plus the legacy stage cells. The preparing-metadata
        // operation is separate; snapshots never write global pipeline cells for a family.
        const allowed = new Set<string>();
        if (operation.obsId !== undefined) {
          allowed.add(`obs:${operation.obsId}:run`);
          allowed.add(`obs:${operation.obsId}:capture`);
          allowed.add(`obs:${operation.obsId}:publish`);
        } else {
          allowed.add(runCellIdOf(next, undefined, undefined) ?? "system:run");
          allowed.add("capture:browser");
          allowed.add("capture:file");
          for (const id of Object.keys(next.cells)) {
            if (id.startsWith("sink:")) {
              allowed.add(id);
            }
          }
        }
        for (const id of changed) {
          if (!allowed.has(id)) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Snapshot write escapes its owner cells at ${id}`
              })
            );
          }
        }
        return;
      }
      case "lifecycle": {
        // Mirror the writer's own resolution (including single-family fallback): the
        // footprint rejects anywhere-else, not the resolver's cell.
        const runCell = runCellIdOf(next, undefined, operation.obsId) ?? "system:run";
        for (const id of changed) {
          if (id !== runCell) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Lifecycle write escapes its run cell at ${id}`
              })
            );
          }
        }
        return;
      }
      case "call": {
        const targetCell = operation.targetCell ?? cellIdForScope(operation.scope);
        // Surface intent first (pre-derivation keys), then the derived board: the patch
        // layer may demote the caller's OWN run cell, which is derivation — not a surface
        // license for arbitrary sibling writes.
        yield* validateCallPatchFootprint(
          operation.scope,
          targetCell,
          operation.obsId,
          operation.payload,
          [...operation.patchCellIds]
        );
        const familyRunCell =
          operation.obsId === undefined ? "system:run" : `obs:${operation.obsId}:run`;
        for (const id of changed) {
          if (id !== familyRunCell && !operation.patchCellIds.includes(id)) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Call ${operation.scope} on ${targetCell} writes foreign cell ${id}`
              })
            );
          }
        }
        yield* validateCallCommitSemantics(operation, current, next);
        return;
      }
      case "prepareMeta": {
        // Bounded preparation metadata: the preparing lease of the SAME family may only
        // refresh capture readonly sourceType/sourceMode and publish readonly streamId
        // (stage address remap). Every other field of those cells and every other cell
        // stays byte-identical; anything else is a preparation input error, not a write.
        const captureId = `obs:${operation.obsId}:capture`;
        const publishId = `obs:${operation.obsId}:publish`;
        for (const id of changed) {
          const allowedKeys =
            id === captureId
              ? ["sourceType", "sourceMode"]
              : id === publishId
                ? ["streamId"]
                : undefined;
          if (allowedKeys === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Prepare metadata write escapes its family cells at ${id}`
              })
            );
          }
          const before = current.cells[id];
          const after = next.cells[id];
          if (before === undefined || after === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Prepare metadata removes family cell ${id}`
              })
            );
          }
          const same = (a: unknown, b: unknown): boolean =>
            a === b || JSON.stringify(a) === JSON.stringify(b);
          if (
            before.label !== after.label ||
            before.catalog !== after.catalog ||
            before.status !== after.status ||
            !same(before.settings, after.settings) ||
            !same(before.functions, after.functions) ||
            !same(before.refs, after.refs)
          ) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Prepare metadata alters non-metadata fields of ${id}`
              })
            );
          }
          const beforeRo = before.readonly ?? {};
          const afterRo = after.readonly ?? {};
          const keys = new Set([...Object.keys(beforeRo), ...Object.keys(afterRo)]);
          for (const key of keys) {
            if (allowedKeys.includes(key)) {
              // Allowed metadata keys may appear, change, or disappear across the remap,
              // but any value actually present must be a string (no objects smuggled).
              const beforeValue = beforeRo[key];
              const afterValue = afterRo[key];
              if (
                (beforeValue !== undefined && typeof beforeValue !== "string") ||
                (afterValue !== undefined && typeof afterValue !== "string")
              ) {
                return yield* Effect.fail(
                  new LiveStreakConfigError({
                    message: `Prepare metadata smuggles non-string ${key} on ${id}`
                  })
                );
              }
              continue;
            }
            if (!same(beforeRo[key], afterRo[key])) {
              return yield* Effect.fail(
                new LiveStreakConfigError({
                  message: `Prepare metadata alters readonly ${key} on ${id}`
                })
              );
            }
          }
        }
        return;
      }
      case "sessionAdd":
      case "sessionRemove":
      case "sessionClose": {
        // Structural session validation happens in the session commit paths (delta-validated
        // against the current index); the updater already applied only those shapes.
        return;
      }
    }
  });

/**
 * Operation footprint table for surface-returned patches (pre-derivation intent): capture and
 * publish configure/close touch exactly the addressed cell; run/pause/market calls touch
 * exactly theirs; kind switches touch exactly the payload family's cell. Prepared demotion of
 * the caller's own run cell is derived by the patch layer afterwards, not surface output.
 */
const validateCallPatchFootprint = (
  scope: string,
  targetCell: string,
  obsId: string | undefined,
  payload: unknown,
  patchCellIds: ReadonlyArray<string>
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fnName = scope.split(":").at(-1) ?? "";
    let allowed: ReadonlySet<string>;
    if (fnName === "captureKind") {
      const kindObsId = readPayloadObsId(payload) ?? obsId;
      if (kindObsId === undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: `Scope ${scope} requires an observation obsId` })
        );
      }
      allowed = new Set([observationCellId(kindObsId, "capture")]);
    } else if (fnName === "publishKind") {
      const kindObsId = readPayloadObsId(payload) ?? obsId;
      if (kindObsId === undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: `Scope ${scope} requires an observation obsId` })
        );
      }
      allowed = new Set([observationCellId(kindObsId, "publish")]);
    } else {
      allowed = new Set([targetCell]);
    }
    for (const id of patchCellIds) {
      if (!allowed.has(id)) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Call ${scope} on ${targetCell} writes foreign cell ${id}`
          })
        );
      }
    }
  });

/**
 * Carry the registered stream identity across a lifecycle patch's unsets: goLive/setEnded
 * never switch it (register establishes a new identity). Pure merge used by the commit
 * updater before footprint validation, so preservation — not rejection — keeps real go-live
 * flows working while planted or dropped identities cannot slip through unnoticed.
 */
const preserveMarketStreamIdentity = (
  scope: string,
  current: Board,
  next: Board,
  targetCell: string
): Board => {
  const fnName = scope.split(":").at(-1) ?? "";
  if (fnName !== "goLive" && fnName !== "setEnded") {
    return next;
  }
  const currentStreamId = current.cells[targetCell]?.readonly?.streamId;
  if (typeof currentStreamId !== "string") {
    return next;
  }
  const nextCell = next.cells[targetCell];
  if (nextCell === undefined) {
    return next;
  }
  if (nextCell.readonly?.streamId === currentStreamId) {
    return next;
  }
  return {
    ...next,
    cells: {
      ...next.cells,
      [targetCell]: {
        ...nextCell,
        readonly: { ...nextCell.readonly, streamId: currentStreamId }
      }
    }
  };
};

/** Commit-time market semantics: identity match plus lifecycle ordering, rechecked against the
 *  current board (a delayed goLive cannot regress an ended market, and no result may
 *  switch or unset the registered identity). */
const validateCallCommitSemantics = (
  operation: Extract<UpdateOperation, { kind: "call" }>,
  current: Board,
  next: Board
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fnName = operation.scope.split(":").at(-1) ?? "";
    // Presentation cannot change while pause is active: recheck the surface's own entry
    // rule against the current board (a hold→slate admitted before activation conflicts).
    if (fnName === "setPresentation") {
      const targetCell = operation.targetCell ?? cellIdForScope(operation.scope);
      if (current.cells[targetCell]?.settings?.requested === true) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "system:pause:setPresentation cannot change presentation while pause is active"
          })
        );
      }
      return;
    }
    if (fnName !== "goLive" && fnName !== "setEnded") {
      return;
    }
    const targetCell = operation.targetCell ?? cellIdForScope(operation.scope);
    const registered = current.cells[targetCell]?.readonly?.marketId;
    if (typeof registered !== "string" || !registered.startsWith("0x")) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Market ${fnName} requires a registered market on ${targetCell}`
        })
      );
    }
    const explicit = readPayloadMarketId(operation.payload);
    if (explicit !== undefined && explicit !== registered) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Market ${fnName} payload marketId does not match registered ${registered}`
        })
      );
    }
    const nextMarketId = next.cells[targetCell]?.readonly?.marketId;
    if (nextMarketId !== registered) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Market ${fnName} result changes the registered market identity`
        })
      );
    }
    // goLive/setEnded preserve the registered stream identity across the lifecycle
    // patch's unsets (register establishes a new identity; lifecycle never switches it).
    // The caller merges preservation before assign; this check is the backstop invariant.
    if (fnName === "goLive" || fnName === "setEnded") {
      const currentStreamId = current.cells[targetCell]?.readonly?.streamId;
      const nextStreamId = next.cells[targetCell]?.readonly?.streamId;
      if (typeof currentStreamId === "string" && nextStreamId !== currentStreamId) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Market ${fnName} result drops the registered stream identity`
          })
        );
      }
    }
    if (fnName === "goLive" && current.cells[targetCell]?.status[0] === "ended") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Market goLive cannot move an ended market back to live`
        })
      );
    }
  });

const OBS_FAMILY_KINDS = ["run", "pause", "capture", "publish", "market"] as const;

const listCreatedFamilyKeys = (patch: BoardPatch, current: Board): string[] => {
  const keys = new Set<string>();
  for (const [cellId, cellPatch] of Object.entries(patch.cells ?? {})) {
    if (cellPatch.create === undefined || current.cells[cellId] !== undefined) {
      continue;
    }
    const family = familyParts(cellId);
    if (family !== undefined && (OBS_FAMILY_KINDS as readonly string[]).includes(family.kind)) {
      keys.add(family.obsId);
    }
  }
  return [...keys];
};

const readPatchIndex = (patch: BoardPatch): Record<string, unknown> => {
  const set = patch.cells?.["system:config"]?.readonly?.set as Record<string, unknown> | undefined;
  const observations = set?.observations;
  if (typeof observations !== "object" || observations === null || Array.isArray(observations)) {
    return {};
  }
  return observations as Record<string, unknown>;
};

/** Deep value equality for birth-contract comparison (plain data only). */
const deepEqualBirth = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqualBirth(item, right[index]))
    );
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every((key) => Object.hasOwn(rightRecord, key) && deepEqualBirth(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
};

/**
 * Exact session-add birth contract (DQ8): the returned operation must be the one known
 * Add — five coherent creates bound to the fresh obsId with canonical defaults, one index
 * entry matching this call's normalized payload, machine births only, exact system:config
 * fields. Later legitimate operations are never compared with birth defaults; this guards
 * birth only. Unknown semantic additions (preconfigured media, markets, prepared flags,
 * receipts, extra refs/functions) fail closed.
 */
const validateSessionBirthContract = (
  patch: BoardPatch,
  payload: unknown,
  current: Board,
  newKey: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fail = (why: string): Effect.Effect<never, LiveStreakError> =>
      Effect.fail(new LiveStreakConfigError({ message: `Session add rejected: ${why}` }));
    const record =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const chain = typeof record.chain === "string" ? record.chain.trim() : "";
    if (title === "" || chain === "") {
      return yield* fail("title and chain must be non-empty");
    }
    const sessionRunId = current.cells["system:config"]?.readonly?.runId;
    const checkStatus = (
      cellId: string,
      status: unknown,
      state: string,
      createdAtMs: number
    ): Effect.Effect<void, LiveStreakError> =>
      Effect.gen(function* () {
        if (
          !Array.isArray(status) ||
          status[0] !== state ||
          status[1] !== null ||
          status[2] !== createdAtMs
        ) {
          return yield* fail(`${cellId} status must be [${state}, null, createdAtMs]`);
        }
      });
    const indexEntry = readPatchIndex(patch)[newKey];
    if (typeof indexEntry !== "object" || indexEntry === null || Array.isArray(indexEntry)) {
      return yield* fail("missing index entry for the new family");
    }
    const entry = indexEntry as Record<string, unknown>;
    const createdAtMs = entry.createdAtMs;
    if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs) || createdAtMs < 0) {
      return yield* fail("index entry needs a finite nonnegative createdAtMs");
    }
    if (entry.title !== title || entry.chain !== chain) {
      return yield* fail("index entry must match this call's title and chain");
    }
    for (const [key, value] of Object.entries(entry)) {
      if (key !== "title" && key !== "chain" && key !== "createdAtMs") {
        void value;
        return yield* fail(`index entry carries unexpected field ${key}`);
      }
    }
    const cells = patch.cells ?? {};
    const expectedFamily: Record<string, { catalog: string; label: string; status: string }> = {
      [`obs:${newKey}:run`]: { catalog: "system:run", label: "Run", status: "created" },
      [`obs:${newKey}:pause`]: { catalog: "system:pause", label: "Pause", status: "idle" },
      [`obs:${newKey}:market`]: { catalog: "market", label: "Market", status: "none" },
      [`obs:${newKey}:capture`]: { catalog: "capture:file", label: "Capture", status: "idle" },
      [`obs:${newKey}:publish`]: { catalog: "sink:live", label: "Publish", status: "idle" }
    };
    for (const [cellId, spec] of Object.entries(expectedFamily)) {
      const cellPatch = cells[cellId];
      if (cellPatch === undefined || Object.keys(cellPatch).length !== 1 || cellPatch.create === undefined) {
        return yield* fail(`${cellId} must be a bare create`);
      }
      const created = cellPatch.create;
      if (created.label !== spec.label || created.catalog !== spec.catalog) {
        return yield* fail(`${cellId} must carry its birth label and catalog`);
      }
      if (!deepEqualBirth(created.functions, expectedFamilyFunctions(cellId))) {
        return yield* fail(`${cellId} must advertise exactly its birth functions`);
      }
      yield* checkStatus(cellId, created.status, spec.status, createdAtMs);
    }
    const runCreated = cells[`obs:${newKey}:run`]!.create!;
    if (!deepEqualBirth(runCreated.settings, defaultControlRun)) {
      return yield* fail("run settings must equal the control default");
    }
    if (
      !deepEqualBirth(runCreated.readonly, {
        runId: sessionRunId,
        obsId: newKey,
        prepared: false
      })
    ) {
      return yield* fail("run readonly must bind session runId, obsId and prepared=false");
    }
    if (runCreated.refs !== undefined) {
      return yield* fail("run must not carry refs at birth");
    }
    const pauseCreated = cells[`obs:${newKey}:pause`]!.create!;
    if (!deepEqualBirth(pauseCreated.settings, defaultControlPause)) {
      return yield* fail("pause settings must equal the control default");
    }
    if (!deepEqualBirth(pauseCreated.readonly, { obsId: newKey })) {
      return yield* fail("pause readonly must carry only obsId");
    }
    if (pauseCreated.refs !== undefined) {
      return yield* fail("pause must not carry refs at birth");
    }
    const marketCreated = cells[`obs:${newKey}:market`]!.create!;
    if (
      !deepEqualBirth(marketCreated.readonly, {
        registrationState: "none",
        obsId: newKey,
        title,
        chain
      })
    ) {
      return yield* fail("market readonly must be unregistered with this call's title/chain");
    }
    if (marketCreated.settings !== undefined || marketCreated.refs !== undefined) {
      return yield* fail("market must not carry settings or refs at birth");
    }
    const captureCreated = cells[`obs:${newKey}:capture`]!.create!;
    if (!deepEqualBirth(captureCreated.settings, { maxPumpMs: 4 })) {
      return yield* fail("capture settings must equal the birth default");
    }
    if (
      !deepEqualBirth(captureCreated.readonly, {
        obsId: newKey,
        kind: "file",
        sourceType: "file",
        sourceMode: "file",
        configured: false
      })
    ) {
      return yield* fail("capture readonly must be unconfigured file with matching obsId");
    }
    if (captureCreated.refs !== undefined) {
      return yield* fail("capture must not carry refs at birth");
    }
    const publishCreated = cells[`obs:${newKey}:publish`]!.create!;
    if (
      !deepEqualBirth(publishCreated.settings, {
        subscribe: ["publish.video.rendered"],
        required: true
      })
    ) {
      return yield* fail("publish settings must equal the birth subscription");
    }
    if (
      !deepEqualBirth(publishCreated.readonly, { obsId: newKey, kind: "live", configured: false })
    ) {
      return yield* fail("publish readonly must be unconfigured live with matching obsId");
    }
    if (publishCreated.refs !== undefined) {
      return yield* fail("publish must not carry refs at birth");
    }
    // Machine births only when absent in the dispatch context; a concurrently added sibling
    // may have created them since — those current cells are preserved, never replaced.
    for (const [machineId, label, catalog] of [
      ["system:memory", "Memory", "system:memory"],
      ["system:tick", "Tick", "system:tick"]
    ] as const) {
      const machinePatch = cells[machineId];
      if (machinePatch === undefined) {
        continue;
      }
      if (
        Object.keys(machinePatch).length !== 1 ||
        machinePatch.create === undefined ||
        machinePatch.create.label !== label ||
        machinePatch.create.catalog !== catalog ||
        machinePatch.create.functions?.length !== 0
      ) {
        return yield* fail(`${machineId} birth must be the normal empty idle cell`);
      }
      const created = machinePatch.create;
      if (
        created.settings !== undefined ||
        created.refs !== undefined ||
        !deepEqualBirth(created.readonly ?? {}, {}) ||
        created.status?.[0] !== "idle" ||
        created.status?.[1] !== null ||
        !isFiniteTimestamp(created.status?.[2])
      ) {
        return yield* fail(`${machineId} birth must carry no facts or settings`);
      }
    }
    // system:config may change only the observation index and canonical resulting status.
    const configPatch = cells["system:config"];
    if (configPatch === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "Session add rejected: missing system:config" })
      );
    }
    for (const key of Object.keys(configPatch)) {
      if (key !== "readonly" && key !== "status") {
        return yield* fail("system:config may only change index and status on add");
      }
    }
    const setKeys = Object.keys(
      (configPatch.readonly?.set ?? {}) as Record<string, unknown>
    );
    if (setKeys.length !== 1 || setKeys[0] !== "observations") {
      return yield* fail("system:config may only set the observation index on add");
    }
    if (configPatch.readonly?.unset !== undefined) {
      return yield* fail("system:config must not unset on add");
    }
    const configStatus = configPatch.status;
    if (
      !Array.isArray(configStatus) ||
      configStatus[0] !== "configured" ||
      configStatus[1] !== null ||
      !isFiniteTimestamp(configStatus[2])
    ) {
      return yield* fail("system:config status must be configured with a finite timestamp");
    }
    const allowedIds = new Set([
      "system:config",
      "system:memory",
      "system:tick",
      ...Object.keys(expectedFamily)
    ]);
    for (const id of Object.keys(cells)) {
      if (!allowedIds.has(id)) {
        return yield* fail(`unexpected cell ${id} in session add`);
      }
    }
  });

const expectedFamilyFunctions = (cellId: string): readonly string[] => {
  if (cellId.endsWith(":run")) {
    return ["prepare", "start", "await", "stop"];
  }
  if (cellId.endsWith(":pause")) {
    return ["pause", "resume", "setPresentation"];
  }
  if (cellId.endsWith(":market")) {
    return ["register", "goLive", "setEnded", "close"];
  }
  return ["configure", "close"];
};

/** Session-add footprint: system:config index/status, exactly one fresh family, machine cells
 *  only when absent. No mutation of existing families or machine cells. */
const validateSessionAddFootprint = (
  patch: BoardPatch,
  current: Board,
  newKey: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const allowed = new Set<string>(["system:config"]);
    for (const kind of OBS_FAMILY_KINDS) {
      allowed.add(`obs:${newKey}:${kind}`);
    }
    for (const id of ["system:memory", "system:tick"]) {
      if (current.cells[id] === undefined) {
        allowed.add(id);
      }
    }
    for (const id of Object.keys(patch.cells ?? {})) {
      if (!allowed.has(id)) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Session add writes unexpected cell ${id}`
          })
        );
      }
    }
  });

/**
 * Session-remove exact mirror: every currently existing addressed family cell is removed
 * (no sparing, no foreign cells), the index entry is deleted with siblings preserved, and
 * system:config otherwise keeps only its canonical configured/idle status flip. Partial
 * removes and extra changes fail closed.
 */
const validateSessionRemoveFootprint = (
  patch: BoardPatch,
  current: Board,
  obsId: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fail = (why: string): Effect.Effect<never, LiveStreakError> =>
      Effect.fail(new LiveStreakConfigError({ message: `Session remove rejected: ${why}` }));
    const familyIds = OBS_FAMILY_KINDS.map((kind) => `obs:${obsId}:${kind}`);
    const cells = patch.cells ?? {};
    for (const id of familyIds) {
      const cellPatch = cells[id];
      if (current.cells[id] !== undefined && cellPatch?.remove !== true) {
        return yield* fail(`must remove existing family cell ${id}`);
      }
      if (cellPatch !== undefined && cellPatch.remove !== true) {
        return yield* fail(`family cell ${id} must only be removed, not written`);
      }
    }
    for (const id of Object.keys(cells)) {
      if (id !== "system:config" && !familyIds.includes(id)) {
        return yield* fail(`unexpected cell ${id}`);
      }
    }
    const configPatch = cells["system:config"];
    if (configPatch === undefined) {
      return yield* fail("missing system:config");
    }
    for (const key of Object.keys(configPatch)) {
      if (key !== "readonly" && key !== "status") {
        return yield* fail("system:config may only change index and status on remove");
      }
    }
    const setKeys = Object.keys((configPatch.readonly?.set ?? {}) as Record<string, unknown>);
    if (setKeys.length !== 1 || setKeys[0] !== "observations") {
      return yield* fail("system:config may only set the observation index on remove");
    }
    if (configPatch.readonly?.unset !== undefined) {
      return yield* fail("system:config must not unset on remove");
    }
    const status = configPatch.status;
    if (status !== undefined) {
      if (
        !Array.isArray(status) ||
        (status[0] !== "configured" && status[0] !== "idle") ||
        status[1] !== null ||
        !isFiniteTimestamp(status[2])
      ) {
        return yield* fail("system:config status must stay canonical on remove");
      }
    }
  });

/**
 * Session-close exact mirror of closeCall: system:config resets (unsets exactly
 * observations/chain/capture/publish/process, status idle) plus removal of EVERY other
 * current cell — nothing created, no family spared, no session metadata altered. A stale
 * footprint (cells added since dispatch) fails as a clear conflict at the call site.
 */
const validateSessionCloseFootprint = (
  patch: BoardPatch,
  current: Board
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const fail = (why: string): Effect.Effect<never, LiveStreakError> =>
      Effect.fail(new LiveStreakConfigError({ message: `Session close rejected: ${why}` }));
    const cells = patch.cells ?? {};
    for (const id of Object.keys(current.cells)) {
      if (id === "system:config") {
        continue;
      }
      if (cells[id]?.remove !== true) {
        return yield* fail(`must remove current cell ${id}`);
      }
    }
    for (const [id, cellPatch] of Object.entries(cells)) {
      if (id !== "system:config" && cellPatch.remove !== true) {
        return yield* fail(`must only remove cell ${id}`);
      }
    }
    const configPatch = cells["system:config"];
    if (configPatch === undefined) {
      return yield* fail("missing system:config reset");
    }
    for (const key of Object.keys(configPatch)) {
      if (key !== "readonly" && key !== "status") {
        return yield* fail("system:config may only reset readonly and status on close");
      }
    }
    const unset = [...(configPatch.readonly?.unset ?? [])].sort();
    const expectedUnset = ["capture", "chain", "observations", "process", "publish"].sort();
    if (!deepEqualBirth(unset, expectedUnset)) {
      return yield* fail("system:config must unset exactly the session fields");
    }
    if (configPatch.readonly?.set !== undefined) {
      return yield* fail("system:config must not set on close");
    }
    const status = configPatch.status;
    if (
      !Array.isArray(status) ||
      status[0] !== "idle" ||
      status[1] !== null ||
      !isFiniteTimestamp(status[2])
    ) {
      return yield* fail("system:config status must reset to idle");
    }
  });

export const failUnsupportedFunction = (scope: string): Effect.Effect<never, LiveStreakRuntimeError> =>
  Effect.fail(
    new LiveStreakRuntimeError({
      message: `Unsupported function scope: ${scope}`
    })
  );

export const stageCellSurface = (
  definition: import("./types.js").ControlCellDefinition
): ControlSurface => ({
  cell: definition,
  functions: []
});
