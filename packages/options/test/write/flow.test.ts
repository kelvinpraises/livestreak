import { LiveStreakConfigError } from "@livestreak/core";
import { flowTokenAbi } from "@flowstream/contracts";
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

describe("write flow", () => {
  it("claimLossFlow encodes vault and side", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.claimLossFlow({
      vaultId: VAULT_ID,
      side: "yes"
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.flowToken,
      abi: flowTokenAbi,
      functionName: "claimLossFlow",
      args: [VAULT_ID, 0]
    });
  });

  it("claimLossFlow encodes no side as 1", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.claimLossFlow({
      vaultId: VAULT_ID,
      side: "no"
    });

    expect(writer.requests[0]?.args).toEqual([VAULT_ID, 1]);
  });

  it("stakeFlow calls skeletonStake with amount", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    const amount = 250_000_000_000_000_000n;
    await transport.stakeFlow({ amount });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.flowToken,
      abi: flowTokenAbi,
      functionName: "skeletonStake",
      args: [amount]
    });
  });

  it("unstakeFlow calls skeletonUnstake with amount", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    const amount = 100_000_000_000_000_000n;
    await transport.unstakeFlow({ amount });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.flowToken,
      abi: flowTokenAbi,
      functionName: "skeletonUnstake",
      args: [amount]
    });
  });

  it("rejects invalid vaultId before claimLossFlow write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.claimLossFlow({
        vaultId: asVaultId("short"),
        side: "yes"
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects zero stake amount before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(transport.stakeFlow({ amount: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects zero unstake amount before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(transport.unstakeFlow({ amount: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    expect(writer.requests).toHaveLength(0);
  });
});
