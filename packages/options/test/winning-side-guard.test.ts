import { describe, expect, it } from "vitest";

import { asVaultId } from "../src/model/ids.js";
import {
  createContractsOptionsReadTransport,
  type ContractReader,
  type ContractReadRequest,
  type OptionsContractAddresses
} from "../src/read/contracts/index.js";

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
    const transport = createContractsOptionsReadTransport({
      reader: createGuardReader(calls, { status: 0 }),
      addresses: ADDRESSES
    });

    const winningSide = await transport.readWinningSide(VAULT_ID);

    expect(winningSide).toBeUndefined();
    expect(calls).not.toContain("winningSide");
    expect(calls).toContain("getVault");
  });

  it("calls winningSide only when vault status is resolved", async () => {
    const calls: string[] = [];
    const transport = createContractsOptionsReadTransport({
      reader: createGuardReader(calls, { status: 3, winningSide: 0 }),
      addresses: ADDRESSES
    });

    const winningSide = await transport.readWinningSide(VAULT_ID);

    expect(winningSide).toBe("yes");
    expect(calls.filter((name) => name === "winningSide")).toHaveLength(1);
  });
});

const createGuardReader = (
  calls: string[],
  vault: { readonly status: number; readonly winningSide?: number }
): ContractReader => ({
  read: async (request) => {
    calls.push(request.functionName);
    return respondGuard(request, vault);
  }
});

const respondGuard = (
  request: ContractReadRequest,
  vault: { readonly status: number; readonly winningSide?: number }
): unknown => {
  const { address, functionName } = request;

  if (address === ADDRESSES.vault) {
    if (functionName === "getVault") {
      return {
        id: VAULT_ID,
        marketId:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
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
  }

  if (address === ADDRESSES.stewardRegistry) {
    if (functionName === "vaultHotState") {
      return {
        active: false,
        until: 0n,
        severity: 0,
        reasonHash:
          "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
    }

    if (functionName === "disputeState") {
      return {
        active: false,
        challengeUntil: 0n,
        proofRef:
          "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
    }
  }

  throw new Error(`Unhandled guard read ${address}.${functionName}`);
};
