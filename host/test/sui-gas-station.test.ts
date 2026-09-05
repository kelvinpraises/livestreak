import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import {
  createSuiGasStation,
  SUI_GAS_STATION_POOL_EXHAUSTED
} from "#services/aa/sui-gas-station.js";

const SPONSOR_SEED = new Uint8Array(32).fill(9);
const sponsorKeypair = Ed25519Keypair.fromSecretKey(SPONSOR_SEED);
const sponsorAddress = sponsorKeypair.getPublicKey().toSuiAddress();
const GAS_PRICE = 1000n;
const GAS_BUDGET = 5_000_000n;

const GAS_COINS = [
  {
    objectId: "0x9999999999999999999999999999999999999999999999999999999999999999",
    version: "1",
    digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
  },
  {
    objectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    version: "1",
    digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
  }
];

const SENDER =
  "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1";

const createOfflineClient = () => ({
  getReferenceGasPrice: async () => GAS_PRICE,
  getObject: async ({ id }: { id: string }) => ({
    data: {
      objectId: id,
      version: "1",
      digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
      owner: { AddressOwner: sponsorAddress },
      content: {
        dataType: "moveObject",
        type: "0x2::coin::Coin<0x2::sui::SUI>",
        hasPublicTransfer: true,
        fields: { balance: "1000000000" }
      }
    }
  }),
  multiGetObjects: async ({ ids }: { ids: string[] }) =>
    Promise.all(ids.map((id) => createOfflineClient().getObject({ id })))
});

const createTestStation = (poolSize = 2, maxGasBudget = GAS_BUDGET) =>
  createSuiGasStation({
    config: {
      rpcUrl: "http://offline.invalid",
      sponsorAddress,
      sponsorKeypair,
      gasBudget: GAS_BUDGET,
      gasPrice: GAS_PRICE,
      maxGasBudget,
      poolSize,
      coinMistPerSlot: 50_000_000n,
      reserveTimeoutMs: 60_000,
      minSponsorBalanceMist: 0n
    },
    client: createOfflineClient() as never,
    initialCoins: GAS_COINS.slice(0, poolSize)
  });

describe("sui gas station pool", () => {
  it("does not reuse a coin while sponsorship is in flight", async () => {
    const station = createTestStation(1);
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });

    const first = station.sponsor({ txKindBytes: kindBytes, sender: SENDER });
    await expect(station.sponsor({ txKindBytes: kindBytes, sender: SENDER })).rejects.toMatchObject({
      code: SUI_GAS_STATION_POOL_EXHAUSTED,
      status: 429
    });

    const sponsored = await first;
    expect(sponsored.sponsorAddress).toBe(sponsorAddress);
    expect(sponsored.txBytes.length).toBeGreaterThan(0);
    expect(sponsored.sponsorSignature.length).toBeGreaterThan(0);

    await expect(station.sponsor({ txKindBytes: kindBytes, sender: SENDER })).rejects.toMatchObject({
      code: SUI_GAS_STATION_POOL_EXHAUSTED,
      status: 429
    });
    expect(station.poolStats().reserved).toBe(1);
  });

  it("returns sponsor fields for a valid kind and sender", async () => {
    const station = createTestStation(2);
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });

    const sponsored = await station.sponsor({ txKindBytes: kindBytes, sender: SENDER });

    expect(sponsored).toMatchObject({
      sponsorAddress,
      sponsorSignature: expect.any(String)
    });
    expect(sponsored.txBytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects gas budgets above the configured max", async () => {
    const station = createTestStation(2, 1_000_000n);
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });

    await expect(
      station.sponsor({ txKindBytes: kindBytes, sender: SENDER, gasBudget: 2_000_000n })
    ).rejects.toMatchObject({ status: 400 });
  });
});
