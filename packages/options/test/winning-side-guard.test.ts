import { describe, expect, it } from "vitest";

import { asVaultId } from "../src/model/ids.js";
import { createEvmOptionsReaderFromCall } from "../src/chains/evm/reader.js";
import type { OptionsContractAddresses } from "../src/chains/evm/addresses.js";
import { createFakeChainWriter } from "./helpers/fake-chain.js";

const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);

const ADDRESSES: OptionsContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  lvstToken: "0x0000000000000000000000000000000000000016",
  dripsStreaming: "0x0000000000000000000000000000000000000019"
};

describe("readWinningSide guard", () => {
  it("never calls winningSide for an open vault", async () => {
    const calls: string[] = [];
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, async (_address, _abi, functionName) => {
      calls.push(functionName);
      return respondGuard(functionName, { status: 0 });
    });

    const winningSide = await reader.readWinningSide(VAULT_ID);

    expect(winningSide).toBeUndefined();
    expect(calls).not.toContain("winningSide");
    expect(calls).toContain("getVault");
  });

  it("calls winningSide only when vault status is resolved", async () => {
    const calls: string[] = [];
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, async (_address, _abi, functionName) => {
      calls.push(functionName);
      return respondGuard(functionName, { status: 3, winningSide: 0 });
    });

    const winningSide = await reader.readWinningSide(VAULT_ID);

    expect(winningSide).toBe("yes");
    expect(calls.filter((name) => name === "winningSide")).toHaveLength(1);
  });

  it("fake writer is independent of reader guard tests", () => {
    expect(createFakeChainWriter().fund).toBeTypeOf("function");
  });
});

const respondGuard = (
  functionName: string,
  vault: { readonly status: number; readonly winningSide?: number }
): unknown => {
  if (functionName === "getVault") {
    return {
      id: VAULT_ID,
      marketId: "0x0000000000000000000000000000000000000000000000000000000000000001",
      question: "Next goal",
      creator: "0x00000000000000000000000000000000000000cc",
      status: vault.status,
      outcome: vault.status === 3 ? 1 : 0,
      resolvedAt: vault.status === 3 ? 1_700_001_000 : 0,
      exists: true
    };
  }

  if (functionName === "getVaultPools") {
    return {
      yesTotal: 1_000_000n,
      noTotal: 500_000n,
      yesShareTotal: 100n,
      noShareTotal: 50n
    };
  }

  if (functionName === "winningSide") {
    return vault.winningSide ?? 0;
  }

  if (functionName === "vaultHotState") {
    return {
      active: false,
      until: 0n,
      severity: 0,
      reasonHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
    };
  }

  if (functionName === "disputeState") {
    return {
      active: false,
      challengeUntil: 0n,
      proofRef: "0x0000000000000000000000000000000000000000000000000000000000000000"
    };
  }

  throw new Error(`Unhandled guard read ${functionName}`);
};
