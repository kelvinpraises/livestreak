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
  type StewardMemoryClient
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
    `[gateway] steward host action "${kind}" dropped — forum client unwired in the CLI edge`
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

export const createStewardConsoleEdge = (input: CreateStewardConsoleEdgeInput): ConsoleEdge => {
  const stewardId = input.packageInit.wallet.operatorAddress ?? "remote-console";
  const caller = localOperatorCaller();

  const actionPlanSink: StewardActionPlanSink =
    input.actionPlanSink ??
    createActionPlanSink({
      contract: createStewardContractExecutor(stewardChainConfigFromPackageInit(input.packageInit)),
      host: input.hostActionExecutor ?? { runHostAction: (action) => dropHostAction(action.kind) }
    });

  const runtime = createStewardRuntime({
    config: createStewardRuntimeBootstrap(input.packageInit, {
      runtimeId: "cli-steward-remote",
      stewardId,
      watchedSubjects: [{ kind: "steward", id: stewardId }]
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
      input.memoryClient === undefined ? noopMemorySink : createMemorySink(input.memoryClient),
    actionPlanSink
  });
  const bridge = createStewardBridge({ runtime });

  return {
    package: "steward",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectStewardDescriptors(runtime.readSnapshot()),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const result = await bridge.callAction(remoteCaller, {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      });
      return { txId: pickTxId(result) };
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    readBoard: async () => bridge.readBoard(caller)
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
