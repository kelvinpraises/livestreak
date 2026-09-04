import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asTokenId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import { validateTokenIdForContracts, validateVaultIdForContracts } from "../../src/chains/evm/encode.js";
import { asTxId } from "../../src/chains/types.js";
import { createFakeChainWriter } from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);
const VAULT_ID_B = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000bb"
);
const TO = asUserAddress("0x00000000000000000000000000000000000000dd");

describe("chain writer claim", () => {
  it("withdraw records tokenId, vault, and recipient", async () => {
    const writer = createFakeChainWriter();

    await writer.withdraw({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      action: "withdraw",
      args: { tokenId: TOKEN_ID, vaultId: VAULT_ID, to: TO }
    });
  });

  it("withdrawMany records tokenId, vault list, and recipient", async () => {
    const writer = createFakeChainWriter();

    await writer.withdrawMany({
      tokenId: TOKEN_ID,
      vaultIds: [VAULT_ID, VAULT_ID_B],
      to: TO
    });

    expect(writer.requests[0]?.action).toBe("withdrawMany");
  });

  it("claimLossLvst records tokenId, vault, side, and recipient", async () => {
    const writer = createFakeChainWriter();

    await writer.claimLossLvst({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      to: TO
    });

    expect(writer.requests[0]?.args).toEqual({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      to: TO
    });
  });

  it("rejects invalid vaultId at encode validation", () => {
    expect(() => validateVaultIdForContracts(asVaultId("short"))).toThrow(LiveStreakConfigError);
  });

  it("rejects invalid tokenId at encode validation", () => {
    expect(() => validateTokenIdForContracts(asTokenId(-1n))).toThrow(LiveStreakConfigError);
  });

  it("returns TxId from chain writer", async () => {
    const writer = createFakeChainWriter();

    const txId = await writer.withdraw({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      to: TO
    });

    expect(txId).toBe(asTxId("0xfake_user_op_hash"));
  });
});
