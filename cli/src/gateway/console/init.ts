import type { PackageRuntimeInit, SessionWallet, SettingsDoc } from "@livestreak/schema";
import { chainSettingsFor } from "../../prefs/settings.js";
import { resolveChainAdapter } from "../auth/chain-registry.js";

export const buildPackageInits = (
  settings: SettingsDoc,
  wallet: SessionWallet,
  runId: string
): Record<PackageRuntimeInit["package"], PackageRuntimeInit> => {
  const caip2 = settings.defaultChain;
  const chain = chainSettingsFor(settings, caip2);
  const contracts = resolveChainAdapter(caip2).deriveContracts(chain.contractOverrides);
  const hostUrl = settings.host.url;

  const base = {
    chain: caip2,
    hostUrl,
    wallet
  } as const;

  return {
    observe: {
      ...base,
      package: "observe",
      contracts,
      runId,
      title: runId
    },
    options: {
      ...base,
      package: "options",
      contracts
    },
    bookmaker: {
      ...base,
      package: "bookmaker",
      contracts,
      runId
    },
    steward: {
      ...base,
      package: "steward",
      contracts: {
        stewardRegistry: contracts.stewardRegistry ?? ""
      }
    }
  };
};
