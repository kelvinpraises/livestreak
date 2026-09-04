import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256 } from "viem";

import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";

import { parseVaultCreatedFromLogs } from "../../../src/chains/evm/decode.js";

describe("parseVaultCreatedFromLogs", () => {
  it("reads vaultId from VaultCreated event logs", () => {
    const marketId = `0x${"11".repeat(32)}` as `0x${string}`;
    const vaultId = `0x${"22".repeat(32)}` as `0x${string}`;
    const creator = "0x00000000000000000000000000000000000000aa" as `0x${string}`;

    const topics = encodeEventTopics({
      abi: vaultDriverAbi,
      eventName: "VaultCreated",
      args: {
        marketId,
        vaultId,
        creator
      }
    });

    const question = "Will Team A score?";
    const data = encodeAbiParameters([{ type: "string" }], [question]);

    const logs = [
      {
        address: "0x00000000000000000000000000000000000000bb",
        blockHash: `0x${"00".repeat(32)}`,
        blockNumber: 1n,
        data,
        logIndex: 0,
        removed: false,
        transactionHash: `0x${"33".repeat(32)}`,
        transactionIndex: 0,
        topics
      }
    ];

    expect(parseVaultCreatedFromLogs(logs)).toBe(vaultId);
  });

  it("does not precompute vaultId from marketId and question", () => {
    const marketId = `0x${"11".repeat(32)}` as `0x${string}`;
    const vaultId = `0x${"44".repeat(32)}` as `0x${string}`;
    const creator = "0x00000000000000000000000000000000000000aa" as `0x${string}`;
    const question = "Will Team A score?";

    const precomputed = keccak256(
      new TextEncoder().encode(`${marketId}:${question}`)
    );

    expect(precomputed).not.toBe(vaultId);

    const topics = encodeEventTopics({
      abi: vaultDriverAbi,
      eventName: "VaultCreated",
      args: {
        marketId,
        vaultId,
        creator
      }
    });

    const data = encodeAbiParameters([{ type: "string" }], [question]);

    const logs = [
      {
        address: "0x00000000000000000000000000000000000000bb",
        blockHash: `0x${"00".repeat(32)}`,
        blockNumber: 1n,
        data,
        logIndex: 0,
        removed: false,
        transactionHash: `0x${"33".repeat(32)}`,
        transactionIndex: 0,
        topics
      }
    ];

    expect(parseVaultCreatedFromLogs(logs)).toBe(vaultId);
  });
});
