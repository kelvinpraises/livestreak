// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { actionScopeFor } from "./action-scope.js";
import { projectStewardControls } from "./panel/project.js";
import type { StewardControlsView } from "./panel/types.js";
import { authorizeBridgeCaller, requireAnyScope } from "./scope.js";
import type {
  BridgeCaller,
  CallActionEnvelope,
  CreateStewardBridgeInput,
  StewardBridge
} from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";
import type { StewardBoard } from "../runtime/board.js";

export type {
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateStewardBridgeInput,
  StewardBridge
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
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
          metadata: { details: envelope.scope }
        });
      }

      // S2: a non-trusted caller must ALSO hold the GRANULAR per-action scope the bridge advertises —
      // holding only the broad `bridge:action` permission is no longer enough to veto/penalise/resolve.
      if (caller.trusted !== true) {
        const granular = actionScopeFor(envelope.action);
        if (granular !== undefined) {
          requireAnyScope(caller.grants ?? [], granular);
        }
      }

      return runtime.submitBridgeAction(envelope.action, envelope.args);
    },

    subscribeBoard: (caller, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope);
      return runtime.subscribeBoard(listener);
    }
  };
};

export type { StewardControlsView };
