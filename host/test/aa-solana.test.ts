import {
  assertKoraPreservedSignedTransaction,
  createWalletManager,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  solanaAddress
} from "@livestreak/wallet";
import { createNoopSigner, pipe } from "@solana/kit";
import { compileTransaction } from "@solana/transactions";
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash
} from "@solana/transaction-messages";
import { getTransferSolInstruction } from "@solana-program/system";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "#server.js";
import { createAaRouteDeps, createHostRouteDeps } from "#deps.js";
import { createSolanaPaymaster } from "#services/aa/solana-paymaster.js";
import { defaultHostServerConfig } from "#config/host.js";

const PAYER_SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SENDER = "F7yEXcVsfa8pDMDWnbEmXqEQdSHYzsBSt7uHRj3nBGpo";
const FEE_TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let payerAddress: string;
let payerPrivateKey: Uint8Array;

beforeAll(async () => {
  const manager = createWalletManager("solana", PAYER_SEED, {});
  const account = await manager.getAccount(0);
  payerAddress = await account.getAddress();
  const privateKey = account.keyPair.privateKey;
  if (privateKey === null) throw new Error("payer key unavailable");
  payerPrivateKey = privateKey;
});

const createSolanaEnabledApp = () => {
  const solanaPaymaster = createSolanaPaymaster({
    config: {
      rpcUrl: "http://offline.invalid",
      payerAddress,
      payerPrivateKey,
      feeTokens: [FEE_TOKEN],
      koraUrl: null
    }
  });
  const config = defaultHostServerConfig();
  return createApp({
    ...createHostRouteDeps(config),
    aa: createAaRouteDeps(config, { solanaPaymaster })
  });
};

const buildWire = (feePayer: string) => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(solanaAddress(feePayer), tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: "11111111111111111111111111111111" as never, lastValidBlockHeight: 0n },
        tx
      ),
    (tx) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          source: createNoopSigner(solanaAddress(SENDER)),
          destination: solanaAddress(feePayer),
          amount: 1n
        }),
        tx
      )
  );
  const compiled = compileTransaction(message);
  // Sender partial-signs first (the Kora flow); any 64 bytes stand in for a real signature here.
  return {
    ...compiled,
    signatures: { ...compiled.signatures, [SENDER]: new Uint8Array(64).fill(7) }
  };
};

const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params === undefined ? {} : { params })
});

describe("aa solana paymaster route", () => {
  it("returns 503 when the paymaster is not configured", async () => {
    const app = createApp(createHostRouteDeps(defaultHostServerConfig()));
    const response = await request(app)
      .post("/aa/solana/paymaster")
      .send(rpc("getPayerSigner"))
      .expect(503);
    expect(response.body.error.message).toContain("not configured");
  });

  it("rejects methods outside the Kora allowlist", async () => {
    const response = await request(createSolanaEnabledApp())
      .post("/aa/solana/paymaster")
      .send(rpc("transferTransaction", { amount: 1 }))
      .expect(200);
    expect(response.body.error.code).toBe(-32601);
    expect(response.body.error.message).toContain("not allowed");
  });

  it("answers getPayerSigner and getSupportedTokens from config", async () => {
    const app = createSolanaEnabledApp();
    const signer = await request(app).post("/aa/solana/paymaster").send(rpc("getPayerSigner")).expect(200);
    expect(signer.body.result.signer_address).toBe(payerAddress);

    const tokens = await request(app)
      .post("/aa/solana/paymaster")
      .send(rpc("getSupportedTokens"))
      .expect(200);
    expect(tokens.body.result.tokens).toEqual([FEE_TOKEN]);
  });

  it("co-signs a transaction naming this payer, preserving message + sender signature", async () => {
    const sent = buildWire(payerAddress);
    const sentWire = getBase64EncodedWireTransaction(sent);

    const response = await request(createSolanaEnabledApp())
      .post("/aa/solana/paymaster")
      .send(rpc("signTransaction", { transaction: sentWire }))
      .expect(200);

    const signedWire = response.body.result.signed_transaction as string;
    expect(response.body.result.signer_pubkey).toBe(payerAddress);

    // The wallet-side integrity guard is the checker: message untouched, sender sig preserved.
    assertKoraPreservedSignedTransaction(sentWire, signedWire);

    const signed = getTransactionDecoder().decode(getBase64Encoder().encode(signedWire));
    const payerSignature = signed.signatures[payerAddress as keyof typeof signed.signatures];
    expect(payerSignature).not.toBeNull();
  });

  it("refuses to co-sign a transaction naming a different fee payer", async () => {
    const sent = buildWire(SENDER);
    const response = await request(createSolanaEnabledApp())
      .post("/aa/solana/paymaster")
      .send(rpc("signTransaction", { transaction: getBase64EncodedWireTransaction(sent) }))
      .expect(200);
    expect(response.body.error.code).toBe(-32602);
    expect(response.body.error.message).toContain("fee payer");
  });

  it("advertises solanaSponsorship in the AA descriptor only when configured", async () => {
    const bare = await request(createApp(createHostRouteDeps(defaultHostServerConfig())))
      .get("/aa/descriptor")
      .expect(200);
    expect(bare.body.solanaSponsorship).toBeUndefined();

    const enabled = await request(createSolanaEnabledApp()).get("/aa/descriptor").expect(200);
    expect(enabled.body.solanaSponsorship).toEqual({
      paymasterPath: "/aa/solana/paymaster",
      payerAddress
    });
  });
});
