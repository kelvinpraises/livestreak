// --- exports ---

import { LiveStreakConfigError, LiveStreakCapabilityError } from "@livestreak/core";

import { actionScopeFor } from "./action-scope.js";
import { projectStewardControls } from "./panel/project.js";
import type { StewardControlsView } from "./panel/types.js";
import { stewardWatchSubjects } from "../model/subject.js";
import { authorizeBridgeCaller, hasAnyScope } from "./scope.js";
import type { CapabilityScope, CreateStewardBridgeInput, StewardBridge } from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
} from "./types.js";

export type {
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateStewardBridgeInput,
  StewardBridge,
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
} from "./types.js";

export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";

export const createStewardBridge = (input: CreateStewardBridgeInput): StewardBridge => {
  const { runtime } = input;

  return {
    runtime,

    readBoard: async (caller) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope);
      return runtime.readBoard();
    },

    readControls: async (caller) => {
      authorizeBridgeCaller(caller, bridgeControlsReadScope);
      const board = await runtime.readBoard();
      return projectStewardControls(runtime.readSnapshot(), board.revision);
    },

    callAction: async (caller, envelope) => {
      // Coarse gate (back-compat + trusted-operator short-circuit).
      authorizeBridgeCaller(caller, bridgeActionScope);

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Steward bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope },
        });
      }

      if (envelope.action === "readMandate") {
        authorizeBridgeCaller(caller, "bridge:action:readMandate");
        const args = envelope.args as { vaultId?: unknown } | undefined;
        if (typeof args?.vaultId !== "string" || !input.readMandate)
          throw new Error("Verified mandate read unsupported");
        return input.readMandate(args.vaultId);
      }
      // Configure/close are runtime lens verbs: swap the watched subjects, refresh best-effort
      // (fact-source failures land on the board as lastError, not on the caller).
      if (envelope.action === "configure") {
        const args = readConfigureArgs(envelope.args);
        const subjects = stewardWatchSubjects({
          stewardId: stewardSelfId(runtime),
          ...(args.marketId === undefined ? {} : { marketId: args.marketId }),
          ...(args.vaultId === undefined ? {} : { vaultId: args.vaultId }),
        });
        try {
          await runtime.configure(subjects);
        } catch {
          /* lastError is on the board */
        }
        return { txId: `configured-${args.vaultId ?? args.marketId ?? "steward"}` };
      }
      if (envelope.action === "close") {
        try {
          await runtime.close();
        } catch {
          /* lastError is on the board */
        }
        return { txId: "closed" };
      }

      // S2: a non-trusted caller must ALSO hold the GRANULAR per-action scope the bridge advertises —
      // holding only the broad `bridge:action` permission is no longer enough to veto/penalise/resolve.
      // Remote console grants use the unified `bridge:action:<name>` scope; accept either that or the
      // steward-native granular scope.
      if (caller.trusted !== true) {
        const granular = actionScopeFor(envelope.action);
        if (granular !== undefined) {
          const consoleScope = `${bridgeActionScope}:${envelope.action}` as CapabilityScope;
          const authorized =
            hasAnyScope(caller.grants ?? [], granular) ||
            hasAnyScope(caller.grants ?? [], consoleScope);
          if (!authorized) {
            throw new LiveStreakCapabilityError({
              message: `No capability grant authorizes ${granular} or ${consoleScope}`,
              requiredScope: granular,
            });
          }
        }
      }

      if (envelope.action === "resolve") {
        if (!input.resolve)
          throw new Error(
            "Mandate/evidence resolution plumbing is unavailable; no result submitted",
          );
        return input.resolve(envelope.args);
      }
      if (envelope.action === "recoverResolution") {
        authorizeBridgeCaller(caller, "bridge:action:recoverResolution");
        const args = envelope.args as { vaultId?: unknown } | undefined;
        if (!input.recoverResolution || typeof args?.vaultId !== "string")
          throw new Error("Resolution recovery requires vaultId");
        return input.recoverResolution(args.vaultId);
      }
      return runtime.submitBridgeAction(envelope.action, envelope.args);
    },

    subscribeBoard: (caller, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope);
      return runtime.subscribeBoard(listener);
    },
  };
};

// --- helpers ---

const stewardSelfId = (runtime: CreateStewardBridgeInput["runtime"]): string =>
  runtime.config.watchedSubjects.find((subject) => subject.kind === "steward")?.id ??
  "steward";

const readConfigureArgs = (args: unknown): { marketId?: string; vaultId?: string } => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return {};
  }
  const record = args as Record<string, unknown>;
  return {
    ...(typeof record.marketId === "string" && record.marketId.trim().length > 0
      ? { marketId: record.marketId.trim() }
      : {}),
    ...(typeof record.vaultId === "string" && record.vaultId.trim().length > 0
      ? { vaultId: record.vaultId.trim() }
      : {}),
  };
};

export type { StewardControlsView };
