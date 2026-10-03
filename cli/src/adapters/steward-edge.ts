import { createResolutionClient } from "@livestreak/host";
import { createResolutionController } from "@livestreak/steward";
import { createStewardResolutionStore } from "./steward-resolution-store.js";
import {
  createOptionsChain,
  optionsChainConfigFromPackageInit,
  asVaultId,
} from "@livestreak/options";
import {
  bridgeActionScope,
  createActionPlanSink,
  createContractFactSource,
  createMemoryFactSource,
  createMemorySink,
  createObserveFactSource,
  createStewardBridge,
  createStewardContractExecutor,
  createStewardRuntime,
  createStewardRuntimeBootstrap,
  projectStewardDescriptors,
  stewardChainConfigFromPackageInit,
  type BridgeCaller,
  type CallActionEnvelope,
  type ContractVaultReader,
  type ObserveBoardReader,
  type StewardActionPlanSink,
  type StewardHostActionExecutor,
  type StewardMemoryClient,
} from "@livestreak/steward";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import type { ConsoleEdge } from "../gateway/console/edge.js";
import { localOperatorCaller } from "../gateway/auth/caller.js";

const noopFacts = async () => [] as readonly unknown[];
const noopMemorySink = { remember: () => {} };

// Fallback when no forum executor is injected (tests): host actions are DROPPED — warn once
// per action kind. Production wires the host /forum/messages client at the composition root.
const warnedHostKinds = new Set<string>();
const dropHostAction = (kind: string): void => {
  if (warnedHostKinds.has(kind)) return;
  warnedHostKinds.add(kind);
  console.error(
    `[gateway] steward host action "${kind}" dropped — forum client unwired in the CLI edge`,
  );
};

export interface CreateStewardConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  /** Test seam: substitute the action-plan sink so the operator flow can be driven without a live
   *  contract executor. Production builds the real contract-backed sink. */
  readonly actionPlanSink?: StewardActionPlanSink;
  /** Real vault reads for contract facts (the gateway composes this from the options chain reader). */
  readonly contractVaultReader?: ContractVaultReader;
  /** Real board reads for observe facts (the gateway shares its observe runtime). */
  readonly observeBoardReader?: ObserveBoardReader;
  /** Durable memory (the gateway builds an HTTP client over the host's /memory/records). */
  readonly memoryClient?: StewardMemoryClient;
  /** Forum actions (the gateway builds an HTTP client over the host's /forum/messages). */
  readonly hostActionExecutor?: StewardHostActionExecutor;
}

export const createStewardConsoleEdge = (
  input: CreateStewardConsoleEdgeInput,
): ConsoleEdge => {
  const stewardId = input.packageInit.wallet.operatorAddress ?? "remote-console";
  const caller = localOperatorCaller();

  const contractExecutor = input.actionPlanSink
    ? undefined
    : createStewardContractExecutor(stewardChainConfigFromPackageInit(input.packageInit));
  const actionPlanSink: StewardActionPlanSink =
    input.actionPlanSink ??
    createActionPlanSink({
      contract: {
        ...contractExecutor!,
        executeContractCall: async (call) => {
          if (call.functionName === "resolve")
            throw new Error(
              "Resolution requires mandate, evidence and durable receipt; use guarded resolve action",
            );
          return contractExecutor!.executeContractCall(call);
        },
      },
      host: input.hostActionExecutor ?? {
        runHostAction: (action) => dropHostAction(action.kind),
      },
    });

  const runtime = createStewardRuntime({
    config: createStewardRuntimeBootstrap(input.packageInit, {
      runtimeId: "cli-steward-remote",
      stewardId,
      watchedSubjects: [{ kind: "steward", id: stewardId }],
    }).runtimeConfig,
    contractFactSource:
      input.contractVaultReader === undefined
        ? { readFacts: noopFacts }
        : createContractFactSource(input.contractVaultReader),
    hostFactSource: { readFacts: noopFacts },
    observeFactSource:
      input.observeBoardReader === undefined
        ? { readFacts: noopFacts }
        : createObserveFactSource(input.observeBoardReader),
    memoryFactSource:
      input.memoryClient === undefined
        ? { readFacts: noopFacts }
        : createMemoryFactSource(input.memoryClient),
    memorySink:
      input.memoryClient === undefined
        ? noopMemorySink
        : createMemorySink(input.memoryClient),
    actionPlanSink,
  });
  const readMandate = async (vaultId: string) => {
    const reader = createOptionsChain(
      optionsChainConfigFromPackageInit(input.packageInit),
    ).reader;
    if (!reader.readVaultMandate)
      throw new Error("Verified mandate read unsupported on this chain");
    return reader.readVaultMandate(asVaultId(vaultId));
  };
  let reader: ReturnType<typeof createOptionsChain>["reader"] | undefined;
  const getReader = () =>
    (reader ??= createOptionsChain(
      optionsChainConfigFromPackageInit(input.packageInit),
    ).reader);
  let controller: ReturnType<typeof createResolutionController> | undefined;
  const getController = async () => {
    if (controller) return controller;
    if (!contractExecutor) throw new Error("Live resolution executor unavailable");
    const r = getReader();
    if (!r.readChainTime) throw new Error("Chain clock unavailable for resolution");
    const client = createResolutionClient(input.packageInit.hostUrl);
    // Full chain identity comes from the chain-bound mandate on first submission, not its family.
    const state = createStewardResolutionStore(
      JSON.stringify(input.packageInit.contracts),
      stewardId,
    );
    controller = createResolutionController({
      stewardId,
      readMandate,
      load: state.load,
      save: state.save,
      publish: client.publish,
      readState: async (vaultId) => {
        const [vault, chainTime] = await Promise.all([
          r.readVault(asVaultId(vaultId)),
          r.readChainTime!(),
        ]);
        return { outcome: vault.outcome, disputed: vault.status === "disputed", chainTime };
      },
      execute: async (vaultId, outcome, submitted) =>
        (
          await contractExecutor.executeContractCall(
            {
              contract: "vault",
              functionName: "resolve",
              args: [vaultId, outcome === "yes" ? 1 : 2],
            },
            submitted,
          )
        ).txId,
    });
    return controller;
  };
  const bridge = createStewardBridge({
    runtime,
    readMandate,
    resolve: async (args) => {
      if (!args || typeof args !== "object")
        throw new Error("Resolution arguments required");
      const a = args as {
        vaultId?: unknown;
        subjectId?: unknown;
        outcome?: unknown;
        reason?: unknown;
        evidenceJson?: unknown;
      };
      const vaultId =
        typeof a.vaultId === "string"
          ? a.vaultId
          : typeof a.subjectId === "string"
            ? a.subjectId
            : undefined;
      if (!vaultId || typeof a.evidenceJson !== "string" || a.evidenceJson.length > 65536)
        throw new Error("Resolution requires vaultId and bounded evidenceJson");
      return (await getController()).submit({
        vaultId,
        outcome: a.outcome,
        reason: a.reason,
        evidence: JSON.parse(a.evidenceJson),
      });
    },
    recoverResolution: async (vaultId) => (await getController()).recover(vaultId),
  });

  return {
    package: "steward",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectStewardDescriptors(runtime.readSnapshot()),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const result = await bridge.callAction(remoteCaller, {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args,
      });
      if (envelope.action === "readMandate")
        return result as import("@livestreak/schema").VerifiedVaultMandate;
      if ("recordDigest" in result)
        return { ...result, txId: "txId" in result ? result.txId : undefined };
      return { txId: pickTxId(result) };
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    readBoard: async () => bridge.readBoard(caller),
  };
};

// Action plans surface the real tx hash when present, not "[object Object]".
const pickTxId = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.txId === "string") return o.txId;
    if (typeof o.hash === "string") return o.hash;
    return JSON.stringify(v);
  }
  return String(v);
};
