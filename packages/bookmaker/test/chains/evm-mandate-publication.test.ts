import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";
import { canonicalMandateBytes, mandateCommitment } from "@livestreak/schema";
import { fixtureMandate } from "../../../schema/test/helpers/mandate.js";
import { createEvmBookmakerWriter } from "../../src/chains/evm/writer.js";
import type { BookmakerChainConfig } from "../../src/chains/types.js";

const ports = vi.hoisted(() => ({ send: vi.fn(), allowance: vi.fn(), read: vi.fn(), userOpReceipt: vi.fn(), transactionReceipt: vi.fn() }));
vi.mock("viem", async (original) => ({
  ...await original<typeof import("viem")>(),
  createPublicClient: () => ({
    getChainId: async () => 31337,
    getBlock: async () => ({ timestamp: 1000n }),
    readContract: ports.read
  })
}));
vi.mock("@livestreak/wallet", async (original) => ({
  ...await original<typeof import("@livestreak/wallet")>(),
  createWalletManager: () => ({ getAccount: async () => ({
    sendTransaction: ports.send,
    toReadOnlyAccount: async () => ({ getAddress: async () => `0x${"11".repeat(20)}`, getAllowance: ports.allowance, getUserOperationReceipt: ports.userOpReceipt, getTransactionReceipt: ports.transactionReceipt })
  }) })
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const config = {
  hostUrl: "http://mandates.invalid",
  walletInit: { chain: "evm", seedSource: "raw", config: { provider: "http://rpc.invalid" } },
  seed: "test-only",
  addresses: { vaultDriver: `0x${"01".repeat(20)}`, marketRegistry: `0x${"02".repeat(20)}`, vault: `0x${"03".repeat(20)}`, usdc: `0x${"04".repeat(20)}` }
} as BookmakerChainConfig;

describe("EVM publish-before-create boundary", () => {
  it("fails explicitly on an unavailable bound-creation capability without a legacy write", async () => {
    ports.read.mockRejectedValueOnce(new Error("missing creations getter"));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const mandate = fixtureMandate();
    await expect(createEvmBookmakerWriter(config).createVault({ marketId: mandate.marketId, question: mandate.question, creatorSide: "yes", creatorStake: 5000000n, seedRate: 8333n, mandate, operationId: `0x${"aa".repeat(32)}` })).rejects.toThrow("updated VaultDriver");
    expect(fetcher).not.toHaveBeenCalled(); expect(ports.send).not.toHaveBeenCalled();
  });
  it.each(["failed publication", "tampered readback"])("sends no approval or creation for %s", async (failure) => {
    const mandate = fixtureMandate();
    const commitment = await mandateCommitment(canonicalMandateBytes(mandate));
    ports.read.mockResolvedValue([`0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`]);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
      failure === "failed publication" ? new Response("unavailable", { status: 503 }) :
        init?.method === "POST" ? Response.json({ commitment }, { status: 201 }) : Response.json({})
    );
    vi.stubGlobal("fetch", fetcher);
    const writer = createEvmBookmakerWriter(config);
    await expect(writer.createVault({ marketId: mandate.marketId, question: mandate.question, creatorSide: "yes", creatorStake: 5000000n, seedRate: 8333n, mandate, operationId: `0x${"aa".repeat(32)}` })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalled();
    expect(ports.allowance).not.toHaveBeenCalled();
    expect(ports.send).not.toHaveBeenCalled();
  });
});


describe("confirmed ZeroDev creation receipt", () => {
  it("uses operation-scoped logs instead of another vault in bundled transaction logs", async () => {
    const vaultId = `0x${"22".repeat(32)}` as `0x${string}`;
    const userOpHash = `0x${"aa".repeat(32)}`;
    const txHash = `0x${"bb".repeat(32)}`;
    const commitment = `0x${"cc".repeat(32)}`;
    ports.userOpReceipt.mockResolvedValueOnce({ success: true, logs: [{
      topics: encodeEventTopics({abi: vaultDriverAbi, eventName: "VaultCreated", args: { marketId: `0x${"11".repeat(32)}`, vaultId, creator: `0x${"11".repeat(20)}` }}),
      data: encodeAbiParameters([{type:"string"}], ["A real question"])
    }], receipt: {transactionHash: txHash, logs: [{
      topics: encodeEventTopics({abi: vaultDriverAbi, eventName: "VaultCreated", args: { marketId: `0x${"11".repeat(32)}`, vaultId: `0x${"99".repeat(32)}`, creator: `0x${"11".repeat(20)}` }}),
      data: encodeAbiParameters([{type:"string"}], ["Another bundled vault"])
    }]}});
    ports.read.mockResolvedValueOnce(commitment);
    await expect(createEvmBookmakerWriter(config).confirmCreateVault(userOpHash as never)).resolves.toEqual({vaultId, txId:userOpHash, commitment});
    expect(ports.transactionReceipt).not.toHaveBeenCalled();
  });
});
