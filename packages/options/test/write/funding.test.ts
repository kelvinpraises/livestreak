import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asTokenId, asVaultId } from "../../src/model/ids.js";
import { validateOptionsContractAddresses } from "../../src/chains/evm/addresses.js";
import {
  createFakeChainWriter,
  DEFAULT_FAKE_ADDRESSES,
  type FakeChainWriter
} from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);

describe("chain writer funding", () => {
  it("fund encodes tokenId, vault, side, rate, and deposit", async () => {
    const writer = createFakeChainWriter();

    await writer.fund({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      rate: 13_333n,
      deposit: 1_000_000n
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]).toEqual({
      action: "fund",
      args: {
        tokenId: TOKEN_ID,
        vaultId: VAULT_ID,
        side: "yes",
        rate: 13_333n,
        deposit: 1_000_000n
      }
    });
  });

  it("setLanes records lane payload", async () => {
    const writer = createFakeChainWriter();

    await writer.setLanes({
      tokenId: TOKEN_ID,
      addDeposit: 500_000n,
      lanes: [
        { vaultId: VAULT_ID, side: "yes", rate: 10_000n },
        { vaultId: VAULT_ID, side: "no", rate: 5_000n }
      ]
    });

    expect(writer.requests[0]?.action).toBe("setLanes");
  });

  it("stopFunding records tokenId, vault, and side", async () => {
    const writer = createFakeChainWriter();

    await writer.stopFunding({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no"
    });

    expect(writer.requests[0]).toEqual({
      action: "stopFunding",
      args: { tokenId: TOKEN_ID, vaultId: VAULT_ID, side: "no" }
    });
  });

  it("stopAllFunding records tokenId only", async () => {
    const writer = createFakeChainWriter();

    await writer.stopAllFunding({ tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      action: "stopAllFunding",
      args: { tokenId: TOKEN_ID }
    });
  });

  it("rejects invalid addresses at validation", () => {
    expect(() =>
      validateOptionsContractAddresses({
        ...DEFAULT_FAKE_ADDRESSES,
        marketDriver: "bad" as `0x${string}`
      })
    ).toThrow(LiveStreakConfigError);
  });
});
