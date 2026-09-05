// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MintResult, TxId } from "../chains/types.js";
import { projectOptionsControls, projectOptionsPanel } from "./panel/project.js";
import type { OptionsControlsView } from "./panel/types.js";
import { authorizeBridgeCaller } from "./scope.js";
import type {
  BridgeCaller,
  CallActionEnvelope,
  CreateOptionsBridgeInput,
  OptionsBridge
} from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";
import type { OptionsBoard } from "../runtime/board.js";

export type {
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateOptionsBridgeInput,
  OptionsBridge
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";

export const createOptionsBridge = (input: CreateOptionsBridgeInput): OptionsBridge => {
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
      return projectOptionsControls(board.panel, board.revision);
    },

    readClaims: async (caller) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope);
      return runtime.readClaims();
    },

    readPnl: async (caller, investedUSDC) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope);
      return runtime.readPnl(investedUSDC);
    },

    readStreamState: async (caller, marketId) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope);
      return runtime.readStreamState(marketId);
    },

    previewAccrual: async (caller, input) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope);
      return runtime.previewAccrual(input);
    },

    callAction: async (caller, envelope) => {
      authorizeBridgeCaller(caller, bridgeActionScope);

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Options bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope }
        });
      }

      return dispatchWriterAction(runtime, envelope.action, envelope.args);
    },

    subscribeBoard: (caller, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope);
      return runtime.subscribeBoard(listener);
    },

    watch: (caller, key, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope);
      return runtime.watchMemory(key, listener);
    }
  };
};

// --- helpers ---

const dispatchWriterAction = async (
  runtime: CreateOptionsBridgeInput["runtime"],
  action: string,
  args: unknown
): Promise<TxId | MintResult> => {
  const writer = runtime.chain.writer;

  switch (action) {
    case "mint":
      return writer.mint(readArgs(args));
    case "mintWithSalt":
      return writer.mintWithSalt(readArgs(args));
    case "fund":
      return runtime.fundStream(readArgs(args));
    case "setLanes":
      return writer.setLanes(readArgs(args));
    case "stopFunding":
      return writer.stopFunding(readArgs(args));
    case "stopAllFunding":
      return writer.stopAllFunding(readArgs(args));
    case "withdraw":
      return writer.withdraw(readArgs(args));
    case "withdrawMany":
      return writer.withdrawMany(readArgs(args));
    case "claimLossLvst":
      return writer.claimLossLvst(readArgs(args));
    case "stakeLvst":
      return writer.stakeLvst(readArgs(args));
    case "unstakeLvst":
      return writer.unstakeLvst(readArgs(args));
    case "claimDividends":
      return writer.claimDividends();
    case "transferNft":
      return writer.transferNft(readArgs(args));
    case "approveNft":
      return writer.approveNft(readArgs(args));
    case "setApprovalForAll":
      return writer.setApprovalForAll(readArgs(args));
    default:
      throw new LiveStreakConfigError({
        message: `Unknown options bridge action: ${action}`,
        metadata: { details: action }
      });
  }
};

const readArgs = <T>(args: unknown): T => {
  if (args === null || typeof args !== "object") {
    throw new LiveStreakConfigError({
      message: "Options bridge action args must be an object",
      metadata: { details: String(args) }
    });
  }

  return args as T;
};

export type { OptionsControlsView };
