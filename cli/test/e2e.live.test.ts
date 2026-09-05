/**
 * Gated live end-to-end test: requires a running local stack.
 * Gate: LIVESTREAK_LIVE=1
 * Required: LIVESTREAK_CONFIG (path to livestreak.json), LIVESTREAK_PASSWORD, funded USDC on operator.
 *
 * Skips entirely (with a clear log) when the gate env is not set.
 * NOT run in CI unless the stack is available.
 */
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runProduce } from "../src/commands/produce.js";
import { runVaultCreate } from "../src/commands/vault.js";
import { runNftMint } from "../src/commands/nft.js";
import { runFund, runClaim, runStake } from "../src/commands/vaults.js";
import { loadInitDoc } from "../src/prefs/init-doc.js";

const liveEnabled = process.env["LIVESTREAK_LIVE"] === "1";
const configPath = process.env["LIVESTREAK_CONFIG"];
const password = process.env["LIVESTREAK_PASSWORD"];
const videoPath = process.env["LIVESTREAK_VIDEO"];

const canRun =
  liveEnabled &&
  configPath !== undefined &&
  password !== undefined;

if (!liveEnabled) {
  // eslint-disable-next-line no-console
  console.log("NOT RUN: LIVESTREAK_LIVE=1 not set");
} else if (!canRun) {
  // eslint-disable-next-line no-console
  console.log("NOT RUN: set LIVESTREAK_CONFIG and LIVESTREAK_PASSWORD for live e2e");
}

describe("e2e live — full producer loop", () => {
  it.skipIf(!canRun || !videoPath)(
    "produce → vault create → nft mint → fund → claim → stake",
    async () => {
      await access(configPath!);
      const doc = await loadInitDoc(configPath!);

      // 1. Produce: register market + upload VOD.
      const produceResult = await runProduce({
        title: "CLI e2e test stream",
        videoPath: videoPath!,
        password: password!,
        configPath: configPath!
      });

      expect(produceResult.marketId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(produceResult.vodUrl.length).toBeGreaterThan(0);
      expect(produceResult.streamState.status).toBe(2); // Ended

      const marketId = produceResult.marketId;

      // 2. Vault create: seed a YES vault on the market.
      const vaultCreateOut = await runVaultCreate({
        marketId,
        question: "Will it end in time?",
        side: "yes",
        rate: "1000000", // 1 USDC/s
        deposit: "5000000", // 5 USDC
        password: password!,
        configPath: configPath!
      });

      expect(vaultCreateOut).toContain("vaultId:");
      const vaultIdMatch = vaultCreateOut.match(/vaultId:\s*(0x[0-9a-f]{64})/i);
      expect(vaultIdMatch).not.toBeNull();
      const vaultId = vaultIdMatch![1];

      // 3. NFT mint: get a position token for this market.
      const mintOut = await runNftMint({
        market: marketId,
        password: password!,
        configPath: configPath!
      });

      expect(mintOut).toContain("tokenId:");
      const tokenIdMatch = mintOut.match(/tokenId:\s*(\d+)/);
      expect(tokenIdMatch).not.toBeNull();
      const tokenId = tokenIdMatch![1];

      // 4. Fund: open a lane on the YES side of the vault.
      const fundOut = await runFund({
        token: tokenId,
        vault: vaultId,
        side: "yes",
        rate: "1000000",
        deposit: "2000000", // 2 USDC
        password: password!,
        configPath: configPath!
      });

      expect(fundOut).toContain("fundTx:");

      // 5. Claim: withdraw (market is Ended so withdrawal is possible).
      const claimOut = await runClaim({
        token: tokenId,
        vault: vaultId,
        side: "yes",
        password: password!,
        configPath: configPath!
      });

      expect(claimOut).toContain("tx:");

      // 6. Stake: stake a small amount of LVST received from the loss-mint.
      //    Uses doc.options — must exist in the init-doc.
      expect(doc.options.lvstToken.length).toBeGreaterThan(0);

      const stakeOut = await runStake({
        amount: "1",
        password: password!,
        configPath: configPath!
      });

      expect(stakeOut).toContain("tx:");
    },
    // Live test timeout: 5 minutes (bundler + 6 UserOps).
    300_000
  );

  it.skipIf(!canRun || videoPath !== undefined)(
    "skips gracefully when LIVESTREAK_VIDEO is absent (non-video assertions only)",
    async () => {
      await access(configPath!);
      const doc = await loadInitDoc(configPath!);
      // Assert the init-doc looks like a real config (basic sanity without sending txs).
      expect(doc.chain.chainId).toBeGreaterThan(0);
      expect(doc.options.marketDriver).toMatch(/^0x[0-9a-f]{40}$/);
    }
  );
});
