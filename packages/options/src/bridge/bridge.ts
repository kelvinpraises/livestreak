// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { coerceArgsBySchema, SchemaCoercionError } from "@livestreak/schema";

import { asMarketId } from "../model/ids.js";
import { asTxId, type MintResult, type TxId } from "../chains/types.js";
import { optionsActionInputSchema } from "./panel/descriptors.js";
import { projectOptionsControls } from "./panel/project.js";
import type { OptionsControlsView } from "./panel/types.js";
import { authorizeBridgeCaller } from "./scope.js";
import type {
  CreateOptionsBridgeInput,
  OptionsBridge
} from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

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

      const result = await dispatchWriterAction(runtime, envelope.action, envelope.args);

      // Reflect a chain write on the board immediately (configure/close publish themselves).
      if (envelope.action !== "configure" && envelope.action !== "close") {
        const active = runtime.activeMarketId();
        if (active !== undefined && runtime.config.user !== undefined) {
          try {
            await runtime.refreshUser(runtime.config.user, active);
          } catch {
            // best-effort: the write already succeeded
          }
        }
      }

      return result;
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
  rawArgs: unknown
): Promise<TxId | MintResult> => {
  const writer = runtime.chain.writer;

  // Configure/close are runtime lens verbs, not chain writes.
  if (action === "configure") {
    const marketId = asMarketId(readStringField(readArgs(rawArgs), "marketId"));
    await runtime.configure({ marketId });
    return asTxId(`configured-${marketId}`);
  }
  if (action === "close") {
    runtime.close();
    return asTxId("closed");
  }

  const args = coerceActionArgs(action, rawArgs);

  switch (action) {
    case "mint":
      return writer.mint(readArgs(args));
    case "mintWithSalt":
      return writer.mintWithSalt(readArgs(args));
    case "fund":
      return runtime.fundStream(readArgs(args));
    // Lane-orchestration gestures: the runtime reads its own snapshot to build the setLanes set
    // (preserving other lanes, applying the balance-first starter deposit, owning the paused
    // registry). They are runtime verbs, not chain writes — but in the remote/WSS model callAction
    // is the ONLY write entrypoint, so the app's stream/pause/resume gestures MUST dispatch here.
    case "streamLane":
      return runtime.streamLane(readArgs(args));
    case "pauseLane":
      return runtime.pauseLane(readArgs(args));
    case "resumeLane":
      return runtime.resumeLane(readArgs(args));
    case "setLanes":
      return writer.setLanes(readArgs(args));
    case "addFunds":
      if (writer.addFunds === undefined) {
        throw new LiveStreakConfigError({
          message: "Options bridge action addFunds is not supported on this chain",
          metadata: { details: action }
        });
      }
      return writer.addFunds(readArgs(args));
    case "stopFunding":
      return writer.stopFunding(readArgs(args));
    case "stopAllFunding":
      return runtime.sweepNft(readArgs(args));
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

// JSON transports have no bigint — the action's own descriptor (format:"bigint") drives coercion,
// so the console form, CLI, and any agent are coerced by one source of truth.
const coerceActionArgs = (action: string, args: unknown): unknown => {
  try {
    return coerceArgsBySchema(optionsActionInputSchema(action), args);
  } catch (error) {
    if (error instanceof SchemaCoercionError) {
      throw new LiveStreakConfigError({ message: error.message });
    }
    throw error;
  }
};

const readStringField = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: `Options bridge action requires ${field}`,
      metadata: { details: String(value) }
    });
  }
  return value.trim();
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
