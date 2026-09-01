import { LiveStreakConfigError } from "@livestreak/core";
import { flowTokenAbi, vaultFundingAbi } from "@flowstream/contracts";
import { describe, expect, it } from "vitest";

import { asVaultId } from "../../src/model/ids.js";
import type { LivestreakContractAddresses } from "../../src/read/contracts/addresses.js";
import { createContractsOptionsWriteTransport } from "../../src/write/transport.js";
import { createFakeContractWriter } from "../helpers/fake-writer.js";

const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);

const ADDRESSES: LivestreakContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  bookmakerRegistry: "0x0000000000000000000000000000000000000012",
  vaultFactory: "0x0000000000000000000000000000000000000013",
  vault: "0x0000000000000000000000000000000000000014",
  vaultFunding: "0x0000000000000000000000000000000000000015",
  flowToken: "0x0000000000000000000000000000000000000016",
  stewardRegistry: "0x0000000000000000000000000000000000000017"
};

describe("write funding", () => {
  it("setFundingRate encodes vault, side, and rate", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.setFundingRate({
      vaultId: VAULT_ID,
      side: "yes",
      ratePerSecond: 13_333n
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.vaultFunding,
      abi: vaultFundingAbi,
      functionName: "setFundingRate",
      args: [VAULT_ID, 0, 13_333n]
    });
  });

  it("setFundingRate encodes no side as 1", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.setFundingRate({
      vaultId: VAULT_ID,
      side: "no",
      ratePerSecond: 0n
    });

    expect(writer.requests[0]?.args).toEqual([VAULT_ID, 1, 0n]);
  });

  it("stopFundingStream encodes vault and side", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.stopFundingStream({
      vaultId: VAULT_ID,
      side: "no"
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.vaultFunding,
      abi: vaultFundingAbi,
      functionName: "stopFundingStream",
      args: [VAULT_ID, 1]
    });
  });

  it("rejects invalid vaultId before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.setFundingRate({
        vaultId: asVaultId("not_bytes32"),
        side: "yes",
        ratePerSecond: 1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects negative ratePerSecond before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.setFundingRate({
        vaultId: VAULT_ID,
        side: "yes",
        ratePerSecond: -1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid addresses at transport construction", () => {
    const writer = createFakeContractWriter();

    expect(() =>
      createContractsOptionsWriteTransport({
        writer,
        addresses: {
          ...ADDRESSES,
          vaultFunding: "bad" as `0x${string}`
        }
      })
    ).toThrow(LiveStreakConfigError);
  });
});
