import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "#server.js";
import { createAaRouteDeps, createHostRouteDeps } from "#deps.js";
import { createSolanaFaucet } from "#services/aa/solana-faucet.js";
import type { SolanaDeployment } from "#config/solana-deployment.js";
import { defaultHostServerConfig } from "#config/host.js";

const DEPLOYER = Keypair.generate();

const LOCALNET: SolanaDeployment = {
  rpc: "http://127.0.0.1:8899",
  usdcMint: "Dedh8Jo9HAYtqaYZiZPubChSuKHzk9hyiocxUwVry8BG",
  deployer: DEPLOYER.publicKey.toBase58(),
  programId: "CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8"
};

const writeKeypair = (kp: Keypair): string => {
  const dir = mkdtempSync(join(tmpdir(), "livestreak-faucet-"));
  const path = join(dir, "id.json");
  writeFileSync(path, JSON.stringify([...kp.secretKey]));
  return path;
};

describe("solana faucet gating", () => {
  it("is unavailable and refuses when the leg is not localnet", async () => {
    const faucet = createSolanaFaucet({ rpcUrl: "https://api.devnet.solana.com", deployment: LOCALNET });
    expect(faucet.available).toBe(false);
    const result = await faucet.faucet({ address: Keypair.generate().publicKey.toBase58() });
    expect(result.status).toBe(404);
  });

  it("is unavailable when there is no deploy snapshot", () => {
    const faucet = createSolanaFaucet({ rpcUrl: "http://127.0.0.1:8899", deployment: null });
    expect(faucet.available).toBe(false);
  });

  it("is available on a localnet rpc + deployment", () => {
    const faucet = createSolanaFaucet({
      rpcUrl: "http://127.0.0.1:8899",
      deployment: LOCALNET,
      deployerKeypairPath: writeKeypair(DEPLOYER)
    });
    expect(faucet.available).toBe(true);
  });

  it("rejects a malformed address before touching the chain", async () => {
    const faucet = createSolanaFaucet({
      rpcUrl: "http://127.0.0.1:8899",
      deployment: LOCALNET,
      deployerKeypairPath: writeKeypair(DEPLOYER)
    });
    const result = await faucet.faucet({ address: "not-a-real-address" });
    expect(result.status).toBe(400);
  });

  it("503s when the mint-authority keypair is absent", async () => {
    const faucet = createSolanaFaucet({
      rpcUrl: "http://127.0.0.1:8899",
      deployment: LOCALNET,
      deployerKeypairPath: join(tmpdir(), "livestreak-faucet-missing", "id.json")
    });
    const result = await faucet.faucet({ address: Keypair.generate().publicKey.toBase58() });
    expect(result.status).toBe(503);
    expect((result.body as { error: { message: string } }).error.message).toContain(
      "mint authority"
    );
  });

  it("503s when the on-disk keypair is not the recorded mint authority", async () => {
    const faucet = createSolanaFaucet({
      rpcUrl: "http://127.0.0.1:8899",
      deployment: LOCALNET,
      deployerKeypairPath: writeKeypair(Keypair.generate())
    });
    const result = await faucet.faucet({ address: Keypair.generate().publicKey.toBase58() });
    expect(result.status).toBe(503);
    expect((result.body as { error: { message: string } }).error.message).toContain(
      "not the mint authority"
    );
  });

  it("route returns 404 when the injected faucet is unavailable (default env: no localnet)", async () => {
    const config = defaultHostServerConfig();
    const app = createApp({
      ...createHostRouteDeps(config),
      aa: createAaRouteDeps(config, {
        solanaFaucet: createSolanaFaucet({
          rpcUrl: "https://api.devnet.solana.com",
          deployment: LOCALNET
        })
      })
    });
    const result = await request(app)
      .post("/aa/solana/faucet")
      .send({ address: Keypair.generate().publicKey.toBase58() })
      .expect(404);
    expect(result.body.error.message).toContain("localnet");
  });
});
