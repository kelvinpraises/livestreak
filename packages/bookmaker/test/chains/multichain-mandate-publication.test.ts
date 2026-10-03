import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bcs } from "@livestreak/wallet";
import { canonicalMandateBytes, mandateCommitment } from "@livestreak/schema";
import { fixtureMandate } from "../../../schema/test/helpers/mandate.js";
import { createSolanaBookmakerWriter } from "../../src/chains/solana/writer.js";
import { createSuiBookmakerWriter } from "../../src/chains/sui/writer.js";
import type { BookmakerChainConfig, CreateVaultInput } from "../../src/chains/types.js";
const ports = vi.hoisted(() => ({
  send: vi.fn(),
  inspect: vi.fn(),
  account: vi.fn(),
  decode: vi.fn(),
  time: 1000,
  existing: false,
}));
const solOwner = "11111111111111111111111111111111";
const vaultId = `0x${"66".repeat(32)}`;
vi.mock("@livestreak/contracts/solana", async (original) => ({
  ...(await original<typeof import("@livestreak/contracts/solana")>()),
  decodeProtocolState: ports.decode,
}));
vi.mock("@livestreak/wallet", async (original) => ({
  ...(await original<typeof import("@livestreak/wallet")>()),
  createSolanaRpc: () => ({
    getGenesisHash: () => ({ send: async () => "testchain" }),
    getSlot: () => ({ send: async () => 1n }),
    getBlockTime: () => ({ send: async () => BigInt(ports.time) }),
    getAccountInfo: () => ({ send: async () => ({ value: { data: ["AA==", "base64"] } }) }),
    getTransaction: () => ({
      send: async () => ({
        meta: {
          err: null,
          returnData: {
            data: [Buffer.from(new Uint8Array(32).fill(0x66)).toString("base64"), "base64"],
          },
        },
      }),
    }),
  }),
  createSuiReadClient: () => ({
    getChainIdentifier: async () => "testchain",
    devInspectTransactionBlock: ports.inspect,
    getObject: async () => ({
      data: {
        content: {
          dataType: "moveObject",
          fields: { timestamp_ms: String(ports.time * 1000) },
        },
      },
    }),
    getCoins: async () => ({
      data: [{ coinObjectId: `0x${"77".repeat(32)}`, balance: "1000000000" }],
    }),
    waitForTransaction: async () => ({
      events: [
        {
          type: "x::vault_driver::VaultCreated",
          parsedJson: { vault_id: Array(32).fill(0x66) },
        },
      ],
    }),
  }),
  createWalletManager: (chain: string) => ({
    getAccount: async () => ({
      getAddress: async () => (chain === "solana" ? solOwner : `0x${"11".repeat(32)}`),
      sendTransaction: ports.send,
      toReadOnlyAccount: async () => ({
        getUserOperationReceipt: async () => ({ success: true }),
      }),
    }),
  }),
  pollUntilUserOperationIncluded: async () => ({ success: true }),
}));
const id = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const suiIds = {
  packageId: id("a"),
  marketRegistry: id("b"),
  vaultRegistry: id("c"),
  vaultDriverRegistry: id("d"),
  dripsRegistry: id("e"),
  streamsRegistry: id("f"),
};
let input: CreateVaultInput;
let commitment = "";
const raw = (codec: { serialize(v: never): { toBytes(): Uint8Array } }, value: unknown) => [
  Array.from(codec.serialize(value as never).toBytes()),
  "value",
];
const vector = (hex: string) =>
  raw(bcs.vector(bcs.u8()), Array.from(Buffer.from(hex.slice(2), "hex")));
beforeEach(() => {
  vi.clearAllMocks();
  ports.time = 1000;
  ports.existing = false;
  ports.send.mockImplementation(async () => {
    ports.existing = true;
    return { hash: "included" };
  });
});
afterEach(() => vi.unstubAllGlobals());
for (const chain of ["solana", "sui"] as const)
  describe(`${chain} publication and recovery`, () => {
    const setup = async () => {
      const mandate = { ...fixtureMandate(), chainId: `${chain}:testchain` };
      input = {
        marketId: mandate.marketId,
        question: mandate.question,
        creatorSide: "yes",
        seedRate: 10n,
        creatorStake: 100n,
        mandate,
        operationId: id("8"),
      };
      commitment = await mandateCommitment(canonicalMandateBytes(mandate));
      ports.decode.mockImplementation(async () => ({
        listVaultIds: () => (ports.existing ? [vaultId] : []),
        vault: () => ({
          id: vaultId,
          marketId: input.marketId,
          question: input.question,
          creator: `0x${"00".repeat(32)}`,
          commitment,
          fundingClose: mandate.fundingClose,
          operationId: input.operationId,
          seedSide: 0,
          seedRate: "10",
          seedDeposit: "100",
        }),
        free: vi.fn(),
      }));
      ports.inspect.mockImplementation(async ({ transactionBlock }) => {
        const fn = transactionBlock.getData().commands[0].MoveCall.function;
        if (fn === "bound_terms")
          return {
            results: [
              { returnValues: [vector(commitment), raw(bcs.u64(), mandate.fundingClose)] },
            ],
          };
        if (fn !== "creation") throw new Error(`unexpected call ${fn}`);
        const values = ports.existing
          ? [
              vector(vaultId),
              vector(input.marketId),
              raw(
                bcs.vector(bcs.u8()),
                Array.from(new TextEncoder().encode(input.question)),
              ),
              raw(bcs.u8(), 0),
              raw(bcs.u256(), 10n),
              raw(bcs.u128(), 100n),
              vector(commitment),
              raw(bcs.u64(), mandate.fundingClose),
            ]
          : [
              raw(bcs.vector(bcs.u8()), []),
              raw(bcs.vector(bcs.u8()), []),
              raw(bcs.vector(bcs.u8()), []),
              raw(bcs.u8(), 0),
              raw(bcs.u256(), 0n),
              raw(bcs.u128(), 0n),
              raw(bcs.vector(bcs.u8()), []),
              raw(bcs.u64(), 0),
            ];
        return { results: [{ returnValues: values }] };
      });
      const config = {
        seed: "test",
        hostUrl: "http://mandates.invalid",
        walletInit: { chain, seedSource: "raw", config: { rpcUrl: "http://rpc.invalid" } },
        addresses:
          chain === "sui"
            ? suiIds
            : {
                programId: solOwner,
                usdcMint: "So11111111111111111111111111111111111111112",
              },
      } as BookmakerChainConfig;
      return chain === "sui"
        ? createSuiBookmakerWriter(config)
        : createSolanaBookmakerWriter(config);
    };
    it.each(["publication failure", "tampered readback"])(
      "%s sends no creation",
      async (failure) => {
        const writer = await setup();
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_url, init) =>
            failure === "publication failure"
              ? new Response("failed", { status: 503 })
              : init?.method === "POST"
                ? Response.json({ commitment })
                : Response.json({ ...input.mandate, question: "tampered" }),
          ),
        );
        await expect(writer.createVault(input)).rejects.toThrow();
        expect(ports.send).not.toHaveBeenCalled();
      },
    );
    it("publishes, reads back, creates once and recovers from a fresh writer after cutoff", async () => {
      const writer = await setup();
      const fetcher = vi.fn(async (_url, init) =>
        init?.method === "POST"
          ? Response.json({ commitment })
          : new Response(new TextDecoder().decode(canonicalMandateBytes(input.mandate))),
      );
      vi.stubGlobal("fetch", fetcher);
      const created = await writer.createVault(input);
      expect(created.vaultId).toBe(vaultId);
      expect(created.commitment).toBe(commitment);
      expect(ports.send).toHaveBeenCalledTimes(1);
      ports.time = input.mandate!.fundingClose + 1;
      fetcher.mockClear();
      const recovered = await (
        chain === "sui" ? createSuiBookmakerWriter : createSolanaBookmakerWriter
      )({
        seed: "test",
        hostUrl: "http://mandates.invalid",
        walletInit: { chain, seedSource: "raw", config: { rpcUrl: "http://rpc.invalid" } },
        addresses:
          chain === "sui"
            ? suiIds
            : {
                programId: solOwner,
                usdcMint: "So11111111111111111111111111111111111111112",
              },
      } as BookmakerChainConfig).createVault(input);
      expect(recovered.vaultId).toBe(vaultId);
      expect(recovered.txId).toContain("reconciled:");
      expect(ports.send).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
      await expect(writer.createVault({ ...input, creatorStake: 101n })).rejects.toThrow(
        "conflict",
      );
      expect(ports.send).toHaveBeenCalledTimes(1);
    });
    it("wrong chain and expired new creations never publish or send", async () => {
      const writer = await setup();
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        writer.createVault({
          ...input,
          mandate: { ...input.mandate!, chainId: `${chain}:other` },
        }),
      ).rejects.toThrow();
      ports.time = input.mandate!.fundingClose;
      await expect(writer.createVault(input)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(ports.send).not.toHaveBeenCalled();
    });
  });
