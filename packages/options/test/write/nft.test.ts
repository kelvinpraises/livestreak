import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asUserAddress } from "../../src/model/ids.js";
import type { OptionsContractAddresses } from "../../src/read/contracts/addresses.js";
import { createContractsOptionsWriteTransport } from "../../src/write/transport.js";
import { createFakeContractWriter } from "../helpers/fake-writer.js";

const TOKEN_ID = asTokenId(42n);
const FROM = asUserAddress("0x0000000000000000000000000000000000000001");
const TO = asUserAddress("0x0000000000000000000000000000000000000002");
const OPERATOR = asUserAddress("0x0000000000000000000000000000000000000003");

const ADDRESSES: OptionsContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  lvstToken: "0x0000000000000000000000000000000000000016",
  dripsStreaming: "0x0000000000000000000000000000000000000019"
};

describe("write nft", () => {
  it("transferNft encodes from, to, and tokenId", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.transferNft({ from: FROM, to: TO, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "transferFrom",
      args: [FROM, TO, TOKEN_ID]
    });
  });

  it("approveNft encodes operator and tokenId", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.approveNft({ operator: OPERATOR, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "approve",
      args: [OPERATOR, TOKEN_ID]
    });
  });

  it("setApprovalForAll encodes operator and approved flag", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await transport.setApprovalForAll({ operator: OPERATOR, approved: true });

    expect(writer.requests[0]).toEqual({
      address: ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "setApprovalForAll",
      args: [OPERATOR, true]
    });
  });

  it("rejects invalid tokenId before transfer write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.transferNft({
        from: FROM,
        to: TO,
        tokenId: asTokenId(-1n)
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid operator before approve write", async () => {
    const writer = createFakeContractWriter();
    const transport = createContractsOptionsWriteTransport({
      writer,
      addresses: ADDRESSES
    });

    await expect(
      transport.approveNft({
        operator: asUserAddress("bad"),
        tokenId: TOKEN_ID
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });
});
