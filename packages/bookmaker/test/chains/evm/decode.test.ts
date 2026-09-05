import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256 } from "viem";

import { vaultDriverAbi, vaultAbi } from "@livestreak/contracts/evm/abis";

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

  it("decodes VaultDriver VaultCreated when inner VaultOpened is also present", () => {
    const marketId = `0x${"11".repeat(32)}` as `0x${string}`;
    const vaultId = `0x${"22".repeat(32)}` as `0x${string}`;
    const creator = "0x00000000000000000000000000000000000000aa" as `0x${string}`;
    const vaultAddress = "0x00000000000000000000000000000000000000cc" as `0x${string}`;
    const vaultDriverAddress = "0x00000000000000000000000000000000000000bb" as `0x${string}`;
    const question = "Will Team A score?";

    const vaultOpenedTopics = encodeEventTopics({
      abi: vaultAbi,
      eventName: "VaultOpened",
      args: { vaultId, marketId, creator }
    });
    const vaultOpenedData = encodeAbiParameters([{ type: "string" }], [question]);

    const driverTopics = encodeEventTopics({
      abi: vaultDriverAbi,
      eventName: "VaultCreated",
      args: { marketId, vaultId, creator }
    });
    const driverData = encodeAbiParameters([{ type: "string" }], [question]);

    const logs = [
      {
        address: vaultAddress,
        blockHash: `0x${"00".repeat(32)}`,
        blockNumber: 1n,
        data: vaultOpenedData,
        logIndex: 0,
        removed: false,
        transactionHash: `0x${"33".repeat(32)}`,
        transactionIndex: 0,
        topics: vaultOpenedTopics
      },
      {
        address: vaultDriverAddress,
        blockHash: `0x${"00".repeat(32)}`,
        blockNumber: 1n,
        data: driverData,
        logIndex: 1,
        removed: false,
        transactionHash: `0x${"33".repeat(32)}`,
        transactionIndex: 0,
        topics: driverTopics
      }
    ];

    expect(parseVaultCreatedFromLogs(logs)).toBe(vaultId);
  });
});
