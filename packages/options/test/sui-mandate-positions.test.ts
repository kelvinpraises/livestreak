import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bcs } from "@livestreak/wallet";
import { canonicalMandateBytes, mandateCommitment } from "@livestreak/schema";
import { fixtureMandate } from "../../schema/test/helpers/mandate.js";
import { createSuiOptionsReader } from "../src/chains/sui/reader.js";
import { createSuiOptionsWriter } from "../src/chains/sui/writer.js";
import type { OptionsChainConfig } from "../src/chains/types.js";
import { asTokenId, asUserAddress, asVaultId } from "../src/model/ids.js";
const ports = vi.hoisted(() => ({
  inspect: vi.fn(),
  send: vi.fn(),
  object: vi.fn(),
  owned: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("@livestreak/wallet", async (original) => ({
  ...(await original<typeof import("@livestreak/wallet")>()),
  createSuiReadClient: () => ({
    devInspectTransactionBlock: ports.inspect,
    getObject: ports.object,
    getOwnedObjects: ports.owned,
    getChainIdentifier: async () => "testchain",
    waitForTransaction: ports.receipt,
  }),
  createWalletManager: () => ({
    getAccount: async () => ({
      getAddress: async () => `0x${"11".repeat(32)}`,
      sendTransaction: ports.send,
    }),
  }),
}));
const id = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const ids = {
  packageId: id("a"),
  protocol: id("b"),
  marketRegistry: id("c"),
  vaultRegistry: id("d"),
  stewardRegistry: id("e"),
  treasuryRegistry: id("f"),
  streamsRegistry: id("1"),
  dripsRegistry: id("2"),
  vaultDriverRegistry: id("3"),
  marketDriverRegistry: id("4"),
  driverRegistry: id("5"),
};
const config = {
  seed: "test",
  addresses: ids,
  hostUrl: "http://mandates.invalid",
  walletInit: { chain: "sui", seedSource: "raw", config: { rpcUrl: "http://rpc.invalid" } },
} as OptionsChainConfig;
const bytes = (hex: string) =>
  Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16));
const ret = (
  codec: { serialize(value: never): { toBytes(): Uint8Array } },
  value: unknown,
) => [Array.from(codec.serialize(value as never).toBytes()), "value"];
const u64 = (n: number) => ret(bcs.u64(), n);
const u256 = (n: bigint) => ret(bcs.u256(), n);
const vec = (v: number[]) => ret(bcs.vector(bcs.u8()), v);
const WAD = 10n ** 18n;
let mandate = { ...fixtureMandate(), chainId: "sui:testchain" };
let commitment = "";
let closed = false;
let zeroLanes = false;
let abort = false;
let resolved = false;
let paid = false;
let collected = false;
const Vault = bcs.struct("VaultData", {
  id: bcs.vector(bcs.u8()),
  market_id: bcs.vector(bcs.u8()),
  question: bcs.vector(bcs.u8()),
  creator: bcs.bytes(32),
  status: bcs.u8(),
  outcome: bcs.u8(),
  resolved_at: bcs.u64(),
  exists: bcs.bool(),
});
beforeEach(async () => {
  vi.clearAllMocks();
  ports.receipt
    .mockReset()
    .mockResolvedValue({ effects: { status: { status: "success" } } });
  closed = false;
  zeroLanes = false;
  abort = false;
  resolved = false;
  paid = false;
  collected = false;
  mandate = { ...fixtureMandate(), chainId: "sui:testchain" };
  commitment = await mandateCommitment(canonicalMandateBytes(mandate));
  ports.object.mockResolvedValue({
    data: { content: { dataType: "moveObject", fields: { timestamp_ms: "1000000" } } },
  });
  ports.owned.mockResolvedValue({ data: [] });
  ports.inspect.mockImplementation(async ({ transactionBlock }) => {
    const call = transactionBlock.getData().commands[0].MoveCall;
    if (abort) return { error: "MoveAbort" };
    let values: unknown[];
    switch (call.function) {
      case "vault_exists":
        values = [ret(bcs.bool(), true)];
        break;
      case "get_vault":
        values = [
          ret(Vault, {
            id: bytes(id("6")),
            market_id: bytes(mandate.marketId),
            question: Array.from(new TextEncoder().encode(mandate.question)),
            creator: bytes(id("7")),
            status: resolved ? 3 : 0,
            outcome: resolved ? 1 : 0,
            resolved_at: 0,
            exists: true,
          }),
        ];
        break;
      case "get_vault_pools":
        values = [u256(100n), u256(100n), u256(10n), u256(20n)];
        break;
      case "hot_state":
        values = [[[0], "option"]];
        break;
      case "bound_terms":
        values = [vec(bytes(commitment)), u64(closed ? 1000 : mandate.fundingClose)];
        break;
      case "funding_close":
        values = [u64(closed ? 1000 : mandate.fundingClose)];
        break;
      case "lane_count":
        values = [u64(zeroLanes ? 0 : 1)];
        break;
      case "get_account_vault_ids":
        values = [ret(bcs.vector(bcs.vector(bcs.u8())), [bytes(id("6"))])];
        break;
      case "lane_vault_at":
        values = [vec(bytes(id("6")))];
        break;
      case "lane_at":
        if (zeroLanes) throw new Error("Removed lane must not be borrowed");
        values = [ret(bcs.u8(), 0), u256(zeroLanes ? 0n : 10n)];
        break;
      case "get_position":
        values = [
          u256(zeroLanes ? 0n : 10n),
          u256(0n),
          u256(5n * WAD),
          u64(1100),
          ret(bcs.bool(), false),
          u64(900),
          u256(0n),
        ];
        break;
      case "pending_shares":
        values = [u256(6n * WAD)];
        break;
      case "claimable":
        values = [u256(0n)];
        break;
      case "is_collected":
        values = [ret(bcs.bool(), collected)];
        break;
      case "is_loss_claimed":
        values = [ret(bcs.bool(), paid)];
        break;
      case "loss_claimable":
        values = [u256(0n)];
        break;
      case "mint_rate":
        values = [u256(1n)];
        break;
      case "market_id":
        values = [vec(bytes(mandate.marketId))];
        break;
      case "streams_state":
        values = [vec([]), vec([]), u64(990), ret(bcs.u128(), 1000), u64(1100)];
        break;
      default:
        throw new Error(`Unexpected read ${call.function}`);
    }
    return { results: [{ returnValues: values }] };
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Sui mandate and retained positions", () => {
  it("independent readers verify the chain commitment; tampering and chain mismatch reject", async () => {
    const fetcher = vi.fn(
      async () => new Response(new TextDecoder().decode(canonicalMandateBytes(mandate))),
    );
    vi.stubGlobal("fetch", fetcher);
    const reader = () =>
      createSuiOptionsReader(ids, "http://rpc.invalid", undefined, {
        hostUrl: config.hostUrl,
      });
    expect((await reader().readVaultMandate!(asVaultId(id("6")))).terms.commitment).toBe(
      commitment,
    );
    expect((await reader().readVaultMandate!(asVaultId(id("6")))).mandate).toEqual(mandate);
    fetcher.mockImplementation(async () =>
      Response.json({ ...mandate, question: "changed" }),
    );
    await expect(reader().readVaultMandate!(asVaultId(id("6")))).rejects.toThrow();
  });
  it("missing content and an expired deadline cause no funding transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const writer = createSuiOptionsWriter(config);
    await expect(
      writer.fund({
        tokenId: asTokenId(1n),
        vaultId: asVaultId(id("6")),
        side: "yes",
        rate: 10n,
        deposit: 100n,
      }),
    ).rejects.toThrow();
    expect(ports.send).not.toHaveBeenCalled();
    closed = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new TextDecoder().decode(
              canonicalMandateBytes({ ...mandate, fundingClose: 1000 }),
            ),
          ),
      ),
    );
    await expect(
      writer.fund({
        tokenId: asTokenId(1n),
        vaultId: asVaultId(id("6")),
        side: "yes",
        rate: 10n,
        deposit: 100n,
      }),
    ).rejects.toThrow();
    expect(ports.send).not.toHaveBeenCalled();
  });
  it("stopped NFT retains BOTH funded sides and banked shares with its shared balance", async () => {
    zeroLanes = true;
    const nft = await createSuiOptionsReader(ids, "http://rpc.invalid").readNft(
      asTokenId(1n),
      asUserAddress(id("7")),
    );
    expect(nft.laneCount).toBe(0);
    expect(nft.lanes.map((l) => l.side)).toEqual(["yes", "no"]);
    expect(
      nft.lanes.every(
        (l) => l.rate === 0n && l.sharesAccrued === 5n && l.sharesLive === 6n,
      ),
    ).toBe(true);
    expect(nft.marketId).toBe(mandate.marketId);
    expect(nft.balance).toBe(1000n);
  });
  it("winner collection and paid loss are read from real contract flags", async () => {
    resolved = true;
    zeroLanes = true;
    const reader = createSuiOptionsReader(ids, "http://rpc.invalid");
    const before = await reader.readNft(asTokenId(1n), asUserAddress(id("7")));
    expect(before.lanes.find((l) => l.side === "yes")?.collectPending).toBe(true);
    expect(before.lanes.find((l) => l.side === "no")?.lossClaimed).toBe(false);
    collected = true;
    paid = true;
    const after = await reader.readNft(asTokenId(1n), asUserAddress(id("7")));
    expect(after.lanes.find((l) => l.side === "yes")?.collectPending).toBe(false);
    expect(after.lanes.find((l) => l.side === "no")?.lossClaimed).toBe(true);
  });
  it("active NFT balance drains from the stored update instead of showing a hardcoded zero", async () => {
    const nft = await createSuiOptionsReader(ids, "http://rpc.invalid").readNft(
      asTokenId(1n),
      asUserAddress(id("7")),
    );
    expect(nft.balance).toBe(900n);
    expect(nft.runwayEndMs).toBe(1100000);
  });
  it("a top-up is gated but pure removal remains usable without mandate content", async () => {
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    ports.owned.mockResolvedValue({
      data: [
        {
          data: {
            objectId: id("8"),
            content: { dataType: "moveObject", fields: { token_id: "1" } },
          },
        },
      ],
    });
    ports.send.mockResolvedValue({ hash: "cleanup" });
    const writer = createSuiOptionsWriter(config);
    await expect(
      writer.setLanes({
        tokenId: asTokenId(1n),
        lanes: [{ vaultId: asVaultId(id("6")), side: "yes", rate: 10n }],
        addDeposit: 1n,
      }),
    ).rejects.toThrow();
    expect(ports.send).not.toHaveBeenCalled();
    fetcher.mockClear();
    await expect(
      writer.setLanes({ tokenId: asTokenId(1n), lanes: [], addDeposit: 0n }),
    ).resolves.toBe("cleanup");
    expect(fetcher).not.toHaveBeenCalled();
    expect(ports.send).toHaveBeenCalledTimes(1);
  });
  it("saves the submitted hash before confirmation and rejects failed execution effects", async () => {
    const events: string[] = [];
    ports.owned.mockResolvedValue({
      data: [
        {
          data: {
            objectId: id("8"),
            content: { dataType: "moveObject", fields: { token_id: "1" } },
          },
        },
      ],
    });
    ports.send.mockResolvedValue({ hash: "actual-hash" });
    ports.receipt.mockImplementation(async () => {
      events.push("receipt");
      return { effects: { status: { status: "failure", error: "MoveAbort" } } };
    });
    const writer = createSuiOptionsWriter({
      ...config,
      onTransactionSubmitted: (hash) => events.push(hash),
    });
    await expect(
      writer.setLanes({ tokenId: asTokenId(1n), lanes: [], addDeposit: 0n }),
    ).rejects.toThrow("MoveAbort");
    expect(events).toEqual(["actual-hash", "receipt"]);
    expect(ports.receipt).toHaveBeenCalledWith({
      digest: "actual-hash",
      options: { showEffects: true },
    });
  });
  it("Move read aborts propagate instead of silently hiding a position", async () => {
    abort = true;
    await expect(
      createSuiOptionsReader(ids, "http://rpc.invalid").readNft(
        asTokenId(1n),
        asUserAddress(id("7")),
      ),
    ).rejects.toMatchObject({
      metadata: {
        cause: expect.objectContaining({ message: expect.stringContaining("MoveAbort") }),
      },
    });
  });
});
