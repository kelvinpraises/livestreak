import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import type { OptionsContractAddresses } from "../../src/read/contracts/addresses.js";
import { createContractsOptionsWriteTransport } from "../../src/write/transport.js";
import { createFakeContractWriter } from "../helpers/fake-writer.js";

const TOKEN_ID = asTokenId(42n);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);
const VAULT_ID_B = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000bb"
);
const TO = asUserAddress("0x00000000000000000000000000000000000000dd");

const ADDRESSES: OptionsContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  lvstToken: "0x0000000000000000000000000000000000000016",
  dripsStreaming: "0x0000000000000000000000000000000000000019"
};

describe("write claim", () => {
  it("withdraw encodes tokenId, vault, and recipient", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.withdraw({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "withdraw",
      args: [TOKEN_ID, VAULT_ID, TO]
    });
  });

  it("withdrawMany encodes tokenId, vault list, and recipient", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.withdrawMany({
      tokenId: TOKEN_ID,
      vaultIds: [VAULT_ID, VAULT_ID_B],
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "withdraw",
      args: [TOKEN_ID, [VAULT_ID, VAULT_ID_B], TO]
    });
  });

  it("claimLossLvst encodes tokenId, vault, side, and recipient", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.claimLossLvst({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "claimLossLvst",
      args: [TOKEN_ID, VAULT_ID, 0, TO]
    });
  });

  it("claimLossLvst encodes no side as 1", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.claimLossLvst({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no",
      to: TO
    });

    expect(writer.requests[0]?.args).toEqual([TOKEN_ID, VAULT_ID, 1, TO]);
  });

  it("rejects invalid vaultId before withdraw write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.withdraw({
        tokenId: TOKEN_ID,
        vaultId: asVaultId("short"),
        to: TO
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid tokenId before claimLossLvst write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.claimLossLvst({
        tokenId: asTokenId(-1n),
        vaultId: VAULT_ID,
        side: "yes",
        to: TO
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });
});
