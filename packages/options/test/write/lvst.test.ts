import { LiveStreakConfigError } from "@livestreak/core";
import { treasuryAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import type { OptionsContractAddresses } from "../../src/read/contracts/addresses.js";
import { createContractsOptionsWriteTransport } from "../../src/write/transport.js";
import { createFakeContractWriter } from "../helpers/fake-writer.js";

const ADDRESSES: OptionsContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  lvstToken: "0x0000000000000000000000000000000000000016",
  dripsStreaming: "0x0000000000000000000000000000000000000019"
};

describe("write lvst", () => {
  it("stakeLvst calls treasury stakeLvst with amount", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    const amount = 250_000_000_000_000_000n;
    await transport.stakeLvst({ amount });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "stakeLvst",
      args: [amount]
    });
  });

  it("unstakeLvst calls treasury unstakeLvst with amount", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    const amount = 100_000_000_000_000_000n;
    await transport.unstakeLvst({ amount });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "unstakeLvst",
      args: [amount]
    });
  });

  it("claimDividends calls treasury claimDividends with no args", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.claimDividends();

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "claimDividends",
      args: []
    });
  });

  it("rejects zero stake amount before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(transport.stakeLvst({ amount: 0n })).rejects.toBeInstanceOf(
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

    await expect(transport.unstakeLvst({ amount: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    expect(writer.requests).toHaveLength(0);
  });
});
