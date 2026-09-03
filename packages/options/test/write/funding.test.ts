import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asVaultId } from "../../src/model/ids.js";
import type { OptionsContractAddresses } from "../../src/read/contracts/addresses.js";
import { createContractsOptionsWriteTransport } from "../../src/write/transport.js";
import { createFakeContractWriter } from "../helpers/fake-writer.js";

const TOKEN_ID = asTokenId(42n);
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

describe("write funding", () => {
  it("fundStream encodes tokenId, vault, side, rate, and deposit", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.fundStream({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      rate: 13_333n,
      deposit: 1_000_000n
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "fund",
      args: [TOKEN_ID, VAULT_ID, 0, 13_333n, 1_000_000n]
    });
  });

  it("fundStream encodes no side as 1", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.fundStream({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no",
      rate: 1n,
      deposit: 1n
    });

    expect(writer.requests[0]?.args).toEqual([TOKEN_ID, VAULT_ID, 1, 1n, 1n]);
  });

  it("setLanes encodes lanes and addDeposit", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.setLanes({
      tokenId: TOKEN_ID,
      addDeposit: 500_000n,
      lanes: [
        { vaultId: VAULT_ID, side: "yes", rate: 10_000n },
        { vaultId: VAULT_ID, side: "no", rate: 5_000n }
      ]
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "setLanes",
      args: [
        TOKEN_ID,
        [
          { vaultId: VAULT_ID, side: 0, rate: 10_000n },
          { vaultId: VAULT_ID, side: 1, rate: 5_000n }
        ],
        500_000n
      ]
    });
  });

  it("stopFunding encodes tokenId, vault, and side", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.stopFunding({
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no"
    });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "stop",
      args: [TOKEN_ID, VAULT_ID, 1]
    });
  });

  it("stopAllFunding encodes tokenId only", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.stopAllFunding({ tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "stopAll",
      args: [TOKEN_ID]
    });
  });

  it("rejects invalid vaultId before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.fundStream({
        tokenId: TOKEN_ID,
        vaultId: asVaultId("not_bytes32"),
        side: "yes",
        rate: 1n,
        deposit: 1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid tokenId before write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.stopAllFunding({ tokenId: asTokenId(-1n) })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects zero rate before fundStream write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.fundStream({
        tokenId: TOKEN_ID,
        vaultId: VAULT_ID,
        side: "yes",
        rate: 0n,
        deposit: 1n
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
          marketDriver: "bad" as `0x${string}`
        }
      })
    ).toThrow(LiveStreakConfigError);
  });
});
