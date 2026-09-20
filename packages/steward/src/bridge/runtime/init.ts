// Gateway-injected bootstrap: map canonical PackageRuntimeInit → steward runtime config slices.
// Steward has no on-chain writer today — init mainly supplies host/run context and default subjects.

import type { PackageRuntimeInit, SessionWallet } from "@livestreak/schema";

import type { StewardSubject } from "../../model/subject.js";
import type { StewardActionContext } from "../../workflow/action/types.js";
import type { StewardDecisionPolicy } from "../../workflow/decision/types.js";
import type { StewardRuleset } from "../../workflow/rules/types.js";
import type { StewardRuntimeConfig } from "../../runtime/config.js";
import type { StewardChainConfig } from "../../chains/index.js";

export type { PackageRuntimeInit, SessionWallet };

// v0 console ruleset: findings from the wired contract facts (vault.status), decisions capped at
// coordinate/record (openThread/annotate). Anything that moves money — resolve, veto, penalise —
// stays a MANUAL console action; auto-executing those is a mechanism-design decision, not a default.
const defaultRuleset = (): StewardRuleset => ({
  id: "remote-console",
  rules: [
    {
      id: "vault-hot",
      findingKind: "market_hot",
      condition: { type: "fact_equals", key: "vault.status", value: "hot" },
      severity: "warning",
      message: "Vault flagged hot on-chain \u2014 steward attention required."
    },
    {
      id: "vault-disputed",
      findingKind: "bad_resolution",
      condition: { type: "fact_equals", key: "vault.status", value: "disputed" },
      severity: "critical",
      message: "Vault resolution is disputed on-chain."
    }
  ]
});
const defaultDecisionPolicy = (): StewardDecisionPolicy => ({
  id: "remote-console",
  mappings: [
    {
      findingKind: "market_hot",
      action: "openThread",
      reason: "Hot vault: open a coordination thread for review."
    },
    {
      findingKind: "bad_resolution",
      action: "annotate",
      reason: "Disputed resolution recorded for operator review."
    }
  ]
});

export const stewardSubjectsFromPackageInit = (
  init: PackageRuntimeInit,
  options?: {
    readonly marketId?: string;
    readonly stewardId?: string;
    readonly extraSubjects?: readonly StewardSubject[];
  }
): readonly StewardSubject[] => {
  const subjects: StewardSubject[] = [];
  const marketId = options?.marketId?.trim();
  if (marketId !== undefined && marketId.length > 0) {
    subjects.push({ kind: "market", id: marketId, marketId });
  }

  subjects.push({
    kind: "steward",
    id: options?.stewardId ?? init.wallet.operatorAddress ?? "remote-console"
  });

  if (options?.extraSubjects !== undefined) {
    subjects.push(...options.extraSubjects);
  }

  return subjects;
};

export const stewardRuntimeConfigFromPackageInit = (
  init: PackageRuntimeInit,
  options?: {
    readonly runtimeId?: string;
    readonly marketId?: string;
    readonly stewardId?: string;
    readonly watchedSubjects?: readonly StewardSubject[];
    readonly ruleset?: StewardRuleset;
    readonly decisionPolicy?: StewardDecisionPolicy;
    readonly actionContext?: StewardActionContext;
  }
): StewardRuntimeConfig => ({
  runtimeId: options?.runtimeId ?? `steward-${init.package}`,
  watchedSubjects:
    options?.watchedSubjects ??
    stewardSubjectsFromPackageInit(init, {
      ...(options?.marketId === undefined ? {} : { marketId: options.marketId }),
      ...(options?.stewardId === undefined ? {} : { stewardId: options.stewardId })
    }),
  ruleset: options?.ruleset ?? defaultRuleset(),
  decisionPolicy: options?.decisionPolicy ?? defaultDecisionPolicy(),
  ...(options?.actionContext === undefined
    ? { actionContext: { stewardId: options?.stewardId ?? "remote-console" } }
    : { actionContext: options.actionContext })
});

export const createStewardRuntimeBootstrap = (
  init: PackageRuntimeInit,
  options?: {
    readonly runtimeId?: string;
    readonly marketId?: string;
    readonly stewardId?: string;
    readonly watchedSubjects?: readonly StewardSubject[];
    readonly ruleset?: StewardRuleset;
    readonly decisionPolicy?: StewardDecisionPolicy;
    readonly actionContext?: StewardActionContext;
  }
): { readonly runtimeConfig: StewardRuntimeConfig } => ({
  runtimeConfig: stewardRuntimeConfigFromPackageInit(init, options)
});

// Map the canonical PackageRuntimeInit -> the on-chain steward executor config (chain-dispatched).
export const stewardChainConfigFromPackageInit = (init: PackageRuntimeInit): StewardChainConfig => ({
  walletInit: init.wallet.walletInit,
  seed: init.wallet.seed,
  addresses:
    init.wallet.walletInit.chain === "sui"
      ? {
          packageId: init.contracts.packageId ?? "",
          stewardRegistry: init.contracts.stewardRegistry ?? "",
          vaultRegistry: init.contracts.vaultRegistry ?? ""
        }
      : init.wallet.walletInit.chain === "solana"
        ? {
            programId: init.contracts.programId ?? "",
            usdcMint: init.contracts.usdcMint ?? ""
          }
        : { stewardRegistry: init.contracts.stewardRegistry ?? "" }
});
