import { type UserAddress, asMarketId } from "@livestreak/options";
import type { PackageRuntimeInit } from "@livestreak/schema";
import { bridgeActionScope, type CallActionEnvelope, type FunctionDescriptor } from "@livestreak/schema";
import {
  createOptionsBridge,
  createOptionsChain,
  createOptionsRuntime,
  createOptionsRuntimeBootstrap,
  optionsChainConfigFromPackageInit,
  projectOptionsDescriptors,
  projectOptionsPanel,
  readUserOptionsSnapshot
} from "@livestreak/options";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateOptionsConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: UserAddress;
}

export const createOptionsConsoleEdge = (input: CreateOptionsConsoleEdgeInput): ConsoleEdge => {
  const chainConfig = optionsChainConfigFromPackageInit(input.packageInit, {
    readRpcUrl: input.readRpcUrl
  });
  const { runtimeConfig } = createOptionsRuntimeBootstrap(input.packageInit, {
    runtimeId: "cli-options-remote",
    readRpcUrl: input.readRpcUrl,
    user: input.userAddress
  });

  const chain = createOptionsChain(chainConfig);
  const runtime = createOptionsRuntime({ chain, chainConfig, config: runtimeConfig });
  const bridge = createOptionsBridge({ runtime });
  const caller = localOperatorCaller();
  // Remember the configured market so describeFunctions re-projects WITH it (board-first reveal). Without
  // this, every catalog projection reads an empty snapshot and mint/fund never appear.
  let configuredMarketId: ReturnType<typeof asMarketId> | undefined;

  const emptyPanel = () =>
    projectOptionsPanel({
      account: input.userAddress,
      markets: [],
      vaults: [],
      nfts: [],
      lvstAccount: {
        account: input.userAddress,
        balance: 0n,
        staked: 0n,
        pendingDividends: 0n
      },
      usdcBalance: 0n
    });

  return {
    package: "options",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      // The configured market LENS (not incidental on-chain holdings) drives the reveal: when
      // unconfigured (initial state or after Close) show only Configure + Close, deterministically.
      if (configuredMarketId === undefined) {
        return projectOptionsDescriptors(emptyPanel());
      }
      try {
        const snapshot = await readUserOptionsSnapshot(chain.reader, input.userAddress, configuredMarketId);
        return projectOptionsDescriptors(projectOptionsPanel(snapshot));
      } catch {
        return projectOptionsDescriptors(emptyPanel());
      }
    },

    dispatch: async (_remoteCaller, envelope: CallActionEnvelope) => {
      if (envelope.action === "configure") {
        configuredMarketId = readConfigureMarketId(envelope.args);
        await runtime.refreshMarket(configuredMarketId);
        await runtime.refreshUser(input.userAddress, configuredMarketId);
        return { txId: `configured-${configuredMarketId}` };
      }
      // Close = deconfigure: drop the configured market lens so mint/fund/withdraw collapse back to
      // just Configure + Close. refresh() fires the board subscription → the gateway re-projects the
      // catalog, which now reads configuredMarketId === undefined → empty. Close is configure's inverse.
      if (envelope.action === "close") {
        configuredMarketId = undefined;
        await runtime.refresh();
        return { txId: "closed" };
      }

      const coercedArgs = coerceRemoteWriteArgs(envelope.action, envelope.args);
      const bridgeEnvelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action: envelope.action,
        args: coercedArgs
      };
      const result = await bridge.callAction(caller, bridgeEnvelope);
      if (typeof result === "object" && result !== null) {
        const r = result as { txId?: unknown; tokenId?: unknown };
        return {
          ...(r.txId === undefined ? {} : { txId: String(r.txId) }),
          ...(r.tokenId === undefined ? {} : { tokenId: String(r.tokenId) })
        };
      }
      return { txId: String(result) };
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    refresh: async () => {
      await runtime.refresh();
    },

    readBoard: () => bridge.readBoard(caller)
  };
};

const readConfigureMarketId = (args: unknown): ReturnType<typeof asMarketId> => {
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    const marketId = (args as { marketId?: unknown }).marketId;
    if (typeof marketId === "string" && marketId.length > 0) {
      return asMarketId(marketId);
    }
  }
  throw new Error("options configure requires { marketId }");
};

const toBigIntField = (value: unknown, field: string): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    return BigInt(value);
  }
  throw new Error(`${field} must be a bigint-compatible value`);
};

const coerceRemoteWriteArgs = (action: string, args: unknown): unknown => {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }
  const record = args as Record<string, unknown>;
  switch (action) {
    case "fund":
      return {
        ...record,
        tokenId: toBigIntField(record.tokenId, "tokenId"),
        deposit: toBigIntField(record.deposit, "deposit"),
        rate: toBigIntField(record.rate, "rate")
      };
    case "withdraw":
    case "withdrawMany":
    case "setLanes":
    case "stopFunding":
    case "stopAllFunding":
    case "approveNft":
    case "transferNft":
      return {
        ...record,
        ...(record.tokenId === undefined ? {} : { tokenId: toBigIntField(record.tokenId, "tokenId") }),
        ...(record.deposit === undefined ? {} : { deposit: toBigIntField(record.deposit, "deposit") }),
        ...(record.rate === undefined ? {} : { rate: toBigIntField(record.rate, "rate") }),
        ...(record.addDeposit === undefined ? {} : { addDeposit: toBigIntField(record.addDeposit, "addDeposit") })
      };
    default:
      return args;
  }
};
