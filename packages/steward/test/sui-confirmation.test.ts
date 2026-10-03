import { beforeEach, describe, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ wait: vi.fn(), send: vi.fn() }));
vi.mock("@livestreak/wallet", async (original) => ({
  ...(await original<typeof import("@livestreak/wallet")>()),
  createSuiReadClient: () => ({ waitForTransaction: ports.wait }),
  createWalletManager: () => ({
    getAccount: async () => ({
      getAddress: async () => "0x" + "1".repeat(64),
      sendTransaction: ports.send,
    }),
  }),
}));
const id = (n: string) => "0x" + n.repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  ports.send.mockResolvedValue({ hash: "actual-hash" });
  ports.wait.mockReset().mockResolvedValue({ effects: { status: { status: "success" } } });
});
import { createSuiStewardExecutor } from "../src/chains/sui.js";
const config = {
  seed: "test",
  walletInit: {
    chain: "sui",
    seedSource: "raw",
    config: { rpcUrl: "http://rpc.invalid", network: "localnet" },
  },
  addresses: { packageId: id("a"), stewardRegistry: id("b"), vaultRegistry: id("c") },
} as never;
describe("Sui Steward confirmation", () => {
  it("persists hash before waiting for readable state", async () => {
    const events: string[] = [];
    ports.wait.mockImplementation(async () => {
      events.push("receipt");
      return { effects: { status: { status: "success" } } };
    });
    expect(
      await createSuiStewardExecutor(config).executeContractCall(
        { contract: "vault", functionName: "resolve", args: [id("d"), 1] },
        async (hash) => {
          events.push(hash);
        },
      ),
    ).toEqual({ txId: "actual-hash" });
    expect(events).toEqual(["actual-hash", "receipt"]);
    expect(ports.wait).toHaveBeenCalledWith({
      digest: "actual-hash",
      options: { showEffects: true },
    });
  });
  it("failed or absent execution effects cannot claim success", async () => {
    for (const receipt of [
      { effects: { status: { status: "failure", error: "MoveAbort" } } },
      {},
    ]) {
      ports.wait.mockResolvedValue(receipt);
      await expect(
        createSuiStewardExecutor(config).executeContractCall({
          contract: "vault",
          functionName: "resolve",
          args: [id("d"), 1],
        }),
      ).rejects.toThrow(/MoveAbort|successful receipt/);
    }
  });
});
