// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { projectStewardControls } from "./panel/project.js";
import type { StewardControlsView } from "./panel/types.js";
import { authorizeBridgeCaller } from "./scope.js";
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
      authorizeBridgeCaller(caller, bridgeActionScope);

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Steward bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope }
        });
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
