import { asUserAddress } from "@livestreak/options";
import type { SessionWallet, SettingsDoc } from "@livestreak/schema";
import { createBookmakerEdge } from "../../adapters/bookmaker-edge.js";
import { createObserveConsoleEdge } from "../../adapters/observe-edge.js";
import { createStewardConsoleEdge } from "../../adapters/steward-edge.js";
import { createOptionsConsoleEdge } from "../../adapters/options-edge.js";
import { chainSettingsFor } from "../../prefs/settings.js";
import { buildPackageInits } from "./init.js";
import type { ConsoleEdge } from "./edge.js";

export const createConsoleEdges = (input: {
  readonly settings: SettingsDoc;
  readonly sessionWallet: SessionWallet;
  readonly runId: string;
}): ConsoleEdge[] => {
  const inits = buildPackageInits(input.settings, input.sessionWallet, input.runId);
  const rpc = chainSettingsFor(input.settings).rpc;
  const userAddress = asUserAddress(input.sessionWallet.operatorAddress as `0x${string}`);
  const usdc = (inits.bookmaker.contracts.usdc ?? "") as `0x${string}`;

  const optionsEdge = createOptionsConsoleEdge({
    packageInit: inits.options,
    readRpcUrl: rpc,
    userAddress
  });

  return [
    optionsEdge,
    createBookmakerEdge({
      packageInit: inits.bookmaker,
      readRpcUrl: rpc,
      userAddress: input.sessionWallet.operatorAddress,
      usdcAddress: usdc
    }),
    createObserveConsoleEdge({
      packageInit: inits.observe,
      runId: input.runId
    }),
    createStewardConsoleEdge({ packageInit: inits.steward })
  ];
};
