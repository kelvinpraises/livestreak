import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "#server.js";
import { createAaRouteDeps, createHostRouteDeps } from "#deps.js";
import { createSuiGasStation } from "#services/aa/sui-gas-station.js";
import { defaultHostServerConfig } from "#config/host.js";

const SPONSOR_SEED = new Uint8Array(32).fill(9);
const sponsorKeypair = Ed25519Keypair.fromSecretKey(SPONSOR_SEED);
const sponsorAddress = sponsorKeypair.getPublicKey().toSuiAddress();
const GAS_PRICE = 1000n;
const GAS_BUDGET = 5_000_000n;
const SENDER =
  "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1";

const GAS_COINS = [
  {
    objectId: "0x9999999999999999999999999999999999999999999999999999999999999999",
    version: "1",
    digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
  }
];

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

const createDepsWithSuiStation = (suiGasStation: ReturnType<typeof createSuiGasStation>) => ({
  ...createHostRouteDeps(defaultHostServerConfig()),
  aa: createAaRouteDeps(defaultHostServerConfig(), { suiGasStation })
});

const createSuiEnabledApp = () => {
  const suiGasStation = createSuiGasStation({
    config: {
      rpcUrl: "http://offline.invalid",
      sponsorAddress,
      sponsorKeypair,
      gasBudget: GAS_BUDGET,
      gasPrice: GAS_PRICE,
      maxGasBudget: GAS_BUDGET,
      poolSize: 1,
      coinMistPerSlot: 50_000_000n,
      reserveTimeoutMs: 60_000,
      minSponsorBalanceMist: 0n
    },
    client: createOfflineClient() as never,
    initialCoins: GAS_COINS
  });

  return createApp(createDepsWithSuiStation(suiGasStation));
};

describe("aa sui sponsor route", () => {
  it("returns 503 when the gas station is not configured", async () => {
    const app = createApp(createHostRouteDeps(defaultHostServerConfig()));

    const response = await request(app)
      .post("/aa/sui/sponsor")
      .send({ txKindBytes: "aGk=", sender: SENDER })
      .expect(503);

    expect(response.body.error.message).toContain("not configured");
  });

  it("returns 400 for invalid sender and garbage txKindBytes", async () => {
    const app = createSuiEnabledApp();

    await request(app)
      .post("/aa/sui/sponsor")
      .send({ txKindBytes: "%%%", sender: SENDER })
      .expect(400);

    await request(app)
      .post("/aa/sui/sponsor")
      .send({ txKindBytes: Buffer.from("not-a-kind").toString("base64"), sender: "0xabc" })
      .expect(400);
  });

  it("sponsors a valid transaction kind", async () => {
    const app = createSuiEnabledApp();
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });

    const response = await request(app)
      .post("/aa/sui/sponsor")
      .send({
        txKindBytes: Buffer.from(kindBytes).toString("base64"),
        sender: SENDER
      })
      .expect(200);

    expect(response.body).toMatchObject({
      sponsorAddress,
      sponsorSignature: expect.any(String),
      txBytes: expect.any(String)
    });
  });

  it("returns 429 when the gas coin pool is exhausted", async () => {
    const app = createSuiEnabledApp();
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });
    const body = {
      txKindBytes: Buffer.from(kindBytes).toString("base64"),
      sender: SENDER
    };

    const [first, second] = await Promise.all([
      request(app).post("/aa/sui/sponsor").send(body),
      request(app).post("/aa/sui/sponsor").send(body)
    ]);

    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 429]);
  });

  it("returns 400 when gasBudget exceeds the configured max", async () => {
    const suiGasStation = createSuiGasStation({
      config: {
        rpcUrl: "http://offline.invalid",
        sponsorAddress,
        sponsorKeypair,
        gasBudget: GAS_BUDGET,
        gasPrice: GAS_PRICE,
        maxGasBudget: 1_000_000n,
        poolSize: 1,
        coinMistPerSlot: 50_000_000n,
        reserveTimeoutMs: 60_000,
        minSponsorBalanceMist: 0n
      },
      client: createOfflineClient() as never,
      initialCoins: GAS_COINS
    });

    const app = createApp(createDepsWithSuiStation(suiGasStation));
    const client = createOfflineClient();
    const tx = new Transaction();
    tx.transferObjects([tx.gas], SENDER);
    const kindBytes = await tx.build({ client: client as never, onlyTransactionKind: true });

    const response = await request(app)
      .post("/aa/sui/sponsor")
      .send({
        txKindBytes: Buffer.from(kindBytes).toString("base64"),
        sender: SENDER,
        gasBudget: "2000000"
      })
      .expect(400);

    expect(response.body.error.message).toContain("gas budget");
  });
});
