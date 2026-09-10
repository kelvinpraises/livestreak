import type { PackageRuntimeInit, SessionWallet, SettingsDoc } from "@livestreak/schema";
import { chainSettingsFor, mergedContracts } from "../../prefs/settings.js";

export const buildPackageInits = (
  settings: SettingsDoc,
  wallet: SessionWallet,
  runId: string
): Record<PackageRuntimeInit["package"], PackageRuntimeInit> => {
  const caip2 = settings.defaultChain;
  const chain = chainSettingsFor(settings, caip2);
  const contracts = mergedContracts(chain);
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
      contracts: {
        vaultDriver: contracts.vaultDriver ?? "",
        marketRegistry: contracts.marketRegistry ?? "",
        vault: contracts.vault ?? "",
        usdc: contracts.mockUsdc ?? ""
      },
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
