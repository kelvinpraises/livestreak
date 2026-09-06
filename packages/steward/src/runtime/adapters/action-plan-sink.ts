import type { WalletChain } from "@livestreak/wallet";
import type {
  StewardActionPlan,
  StewardContractCall,
  StewardHostAction
} from "../../model/action-plan.js";
import type { StewardActionPlanSink } from "../sink.js";

// --- Action-plan sink (WAVE 5 BUILD) — the egress that executes governance ---
//
// Contract calls (triggerHot/resolve/proposePenalty/…) are signed + submitted via `@livestreak/wallet`
// (the sole SDK owner — Sui never pins `@mysten/sui`); host actions (openThread/appendMessage/annotate)
// go through the `@livestreak/host` forum client. Both are injected by the executor; this sink only routes
// each plan's calls to the right executor method and reports what it dispatched.

export interface StewardContractExecutor {
  readonly chain: WalletChain;
  readonly executeContractCall: (call: StewardContractCall) => Promise<{ readonly txId: string }>;
}

export interface StewardHostActionExecutor {
  readonly runHostAction: (action: StewardHostAction) => Promise<void> | void;
}

export interface StewardActionExecutor {
  readonly contract: StewardContractExecutor;
  readonly host: StewardHostActionExecutor;
  // Optional observability hook fired after a plan is dispatched.
  readonly onDispatched?: (summary: DispatchedPlanSummary) => void;
}

export interface DispatchedPlanSummary {
  readonly action: string;
  readonly txIds: readonly string[];
  readonly hostActionKinds: readonly string[];
}

export const createActionPlanSink = (executor: StewardActionExecutor): StewardActionPlanSink => ({
  submit: async (plans: readonly StewardActionPlan[]): Promise<void> => {
    for (const plan of plans) {
      const txIds: string[] = [];
      for (const call of plan.contractCalls) {
        const { txId } = await executor.contract.executeContractCall(call);
        txIds.push(txId);
      }
      for (const action of plan.hostActions) {
        await executor.host.runHostAction(action);
      }
      executor.onDispatched?.({
        action: plan.decision.action,
        txIds,
        hostActionKinds: plan.hostActions.map((action) => action.kind)
      });
    }
  }
});
