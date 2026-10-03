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
import { Effect } from "effect";
import { createSuiMarketRegistrar } from "#market/chains/sui.js";
const config = {
  seed: "test",
  title: "Native",
  walletInit: {
    chain: "sui",
    seedSource: "raw",
    config: { rpcUrl: "http://rpc.invalid", network: "localnet" },
  },
  suiRegistry: { packageId: id("a"), marketRegistryObjectId: id("b") },
} as never;
describe("Sui market confirmation", () => {
  it("registration waits for its receipt before allowing a live transition", async () => {
    const receipt = { effects: { status: { status: "success" } } };
    let release!: (r: typeof receipt) => void;
    ports.wait.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    let finished = false;
    const work = Effect.runPromise(
      createSuiMarketRegistrar(config).registerMarket({
        runId: "native-proof",
        title: "Native",
      }),
    ).then((r) => {
      finished = true;
      return r;
    });
    await vi.waitFor(() => expect(ports.wait).toHaveBeenCalled());
    expect(finished).toBe(false);
    release(receipt);
    expect((await work).userOpHash).toBe("actual-hash");
  });
  it("a failed live transition is surfaced instead of reported as successful", async () => {
    ports.wait.mockResolvedValue({
      effects: { status: { status: "failure", error: "MoveAbort" } },
    });
    await expect(
      Effect.runPromise(
        createSuiMarketRegistrar(config).goLive!({
          marketId: id("d") as never,
          scheme: 0,
          id: "live",
        }),
      ),
    ).rejects.toThrow("MoveAbort");
  });
});
