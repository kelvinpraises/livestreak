// Gateway composition root: builds every package edge over one settings/wallet/runId context and
// cross-wires package surfaces (observe board + options vault reads feed steward's fact ports).

import { Effect } from "effect";
import { openObserveConsoleRuntime, type ObserveRuntime } from "@livestreak/observe";
import { asUserAddress, asVaultId, createOptionsChain, optionsChainConfigFromPackageInit } from "@livestreak/options";
import type {
  ContractVaultReader,
  ObserveBoardReader,
  StewardHostActionExecutor,
  StewardMemoryClient
} from "@livestreak/steward";
import type { SessionWallet, SettingsDoc } from "@livestreak/schema";
import { createBookmakerEdge } from "../../adapters/bookmaker-edge.js";
import { createObserveConsoleEdge } from "../../adapters/observe-edge.js";
import { createStewardConsoleEdge } from "../../adapters/steward-edge.js";
import { createOptionsConsoleEdge } from "../../adapters/options-edge.js";
import { chainSettingsFor } from "../../prefs/settings.js";
import {
  loadIdempotencyPersistencePort,
  loadObserveBoardsPort,
  loadPausedLanesPort
} from "../state/runtime-persistence.js";
import { buildPackageInits } from "./init.js";
import type { ConsoleEdge } from "./edge.js";

export const createConsoleEdges = async (input: {
  readonly settings: SettingsDoc;
  readonly sessionWallet: SessionWallet;
  readonly runId: string;
}): Promise<ConsoleEdge[]> => {
  const inits = buildPackageInits(input.settings, input.sessionWallet, input.runId);
  const rpc = chainSettingsFor(input.settings).rpc;
  const userAddress = asUserAddress(input.sessionWallet.operatorAddress as `0x${string}`);
  const usdc = (inits.bookmaker.contracts.usdc ?? "") as `0x${string}`;

  // File-backed runtime state (survives a gateway restart): pending-userOp recovery, paused lanes,
  // and the observe console board (configured cells restore; active run status resets honestly).
  const [pausedLanes, idempotencyPersistence, observeBoards] = await Promise.all([
    loadPausedLanesPort(),
    loadIdempotencyPersistencePort(),
    loadObserveBoardsPort(input.runId)
  ]);

  const observeRuntime = (
    await Effect.runPromise(
      openObserveConsoleRuntime({
        sessionInit: inits.observe,
        runId: input.runId,
        boardPersistence: observeBoards
      })
    )
  ).runtime;

  return [
    createOptionsConsoleEdge({
      packageInit: inits.options,
      readRpcUrl: rpc,
      userAddress,
      pausedLanes
    }),
    createBookmakerEdge({
      packageInit: inits.bookmaker,
      readRpcUrl: rpc,
      userAddress: input.sessionWallet.operatorAddress,
      usdcAddress: usdc,
      idempotencyPersistence
    }),
    createObserveConsoleEdge({
      packageInit: inits.observe,
      runId: input.runId,
      runtime: observeRuntime,
      hostBaseUrl: input.settings.host.url
    }),
    createStewardConsoleEdge({
      packageInit: inits.steward,
      contractVaultReader: buildStewardVaultReader(inits.options, rpc),
      observeBoardReader: buildStewardBoardReader(observeRuntime, input.runId),
      memoryClient: buildStewardMemoryClient(input.settings.host.url),
      hostActionExecutor: buildStewardForumExecutor(input.settings.host.url)
    })
  ];
};

// --- steward fact readers (gateway composition: packages own the reads, steward owns the facts) ---

const buildStewardBoardReader = (runtime: ObserveRuntime, runId: string): ObserveBoardReader => ({
  readBoard: async () => {
    try {
      return await Effect.runPromise(runtime.readBoard(runId));
    } catch {
      return null;
    }
  }
});

// Forum actions over the host's DB-backed messages API. Fail-open: a forum outage must not
// fail the action plan whose contract leg already executed.
const buildStewardForumExecutor = (hostUrl: string): StewardHostActionExecutor => {
  const base = hostUrl.replace(/\/$/, "");
  return {
    runHostAction: async (action) => {
      const { subject } = action.payload;
      const body = {
        kind:
          action.kind === "openThread"
            ? "thread"
            : action.kind === "appendMessage"
              ? "message"
              : "annotation",
        subjectKind: subject.kind,
        subjectId: subject.id,
        ...(subject.marketId === undefined ? {} : { marketId: subject.marketId }),
        ...(subject.vaultId === undefined ? {} : { vaultId: subject.vaultId }),
        ...(action.payload.stewardId === undefined ? {} : { stewardId: action.payload.stewardId }),
        ...("findingId" in action.payload && action.payload.findingId !== undefined
          ? { findingId: action.payload.findingId }
          : {}),
        ...("title" in action.payload ? { title: action.payload.title } : {}),
        ...("message" in action.payload ? { message: action.payload.message } : {}),
        atMs: Date.now()
      };
      try {
        await fetch(`${base}/forum/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
      } catch {
        /* fail-open */
      }
    }
  };
};

// Durable memory over the host's DB-backed records API. Failures are the caller's to handle:
// the fact source tolerates a throw (lastError on the board); remember is awaited by refresh.
const buildStewardMemoryClient = (hostUrl: string): StewardMemoryClient => {
  const base = hostUrl.replace(/\/$/, "");
  return {
    recall: async (subject) => {
      const query = new URLSearchParams({ subjectKind: subject.kind, subjectId: subject.id });
      const response = await fetch(`${base}/memory/records?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`memory recall failed (${response.status})`);
      }
      const body = (await response.json()) as {
        records?: readonly {
          id: number;
          findingIds: readonly string[];
          decisionActions: readonly string[];
          atMs: number;
          evidenceRefs?: readonly string[];
        }[];
      };
      return (body.records ?? []).map((record) => ({
        key: `steward.memory.${record.id}`,
        value: { findingIds: record.findingIds, decisionActions: record.decisionActions },
        ...(record.evidenceRefs === undefined ? {} : { evidenceRefs: record.evidenceRefs }),
        observedAtMs: record.atMs
      }));
    },
    remember: async (record) => {
      const response = await fetch(`${base}/memory/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectKind: record.subject.kind,
          subjectId: record.subject.id,
          ...(record.subject.marketId === undefined ? {} : { marketId: record.subject.marketId }),
          ...(record.subject.vaultId === undefined ? {} : { vaultId: record.subject.vaultId }),
          findingIds: record.findingIds,
          decisionActions: record.decisionActions,
          atMs: record.atMs
        })
      });
      if (!response.ok) {
        throw new Error(`memory remember failed (${response.status})`);
      }
    }
  };
};

const buildStewardVaultReader = (
  optionsInit: Parameters<typeof optionsChainConfigFromPackageInit>[0],
  readRpcUrl: string
): ContractVaultReader => {
  const reader = createOptionsChain(
    optionsChainConfigFromPackageInit(optionsInit, { readRpcUrl })
  ).reader;
  return {
    chain: optionsInit.chain.startsWith("eip155") ? "evm" : "sui",
    readVaultFacts: async (subject) => {
      if (subject.vaultId === undefined) {
        return [];
      }
      const vault = await reader.readVault(asVaultId(subject.vaultId));
      return [
        { key: "vault.status", value: vault.status },
        { key: "vault.outcome", value: vault.outcome },
        { key: "vault.pools", value: vault.pools },
        { key: "vault.steward", value: vault.steward }
      ];
    }
  };
};
