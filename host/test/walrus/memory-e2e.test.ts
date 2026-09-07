import { describe, expect, it } from "vitest";
import { MemWal } from "@mysten-incubation/memwal";
import { generateDelegateKey } from "@mysten-incubation/memwal/account";
import { createMemoryBindingStore } from "#services/walrus/memory/binding.js";
import { createMemWalAccountOperations } from "#services/walrus/memory/memwal-ops.js";
import { resolveWalrus } from "#infrastructure/walrus/network.js";
import { defaultHostServerConfig } from "#config/host.js";

// Live, host-path MemWal round-trip against Sui testnet.
//
// Unlike memory-live.test.ts (which drives the raw @mysten-incubation/memwal
// package directly), this exercises the HOST-owned layer end to end:
//   createMemWalAccountOperations() -> createMemoryBindingStore().provision()
//   -> on-chain createAccount (Sui testnet WRITE) -> grantDelegate -> the
//   delegate remembers + recalls via the hosted relayer (READ BACK).
//
// Gated so CI stays offline/deterministic. Run with the testnet deployer key
// injected via env (never committed):
//   MEMWAL_LIVE_E2E=1 LIVESTREAK_WALRUS_NETWORK=testnet \
//   LIVESTREAK_MEMORY_OWNER_KEY=suiprivkey1... npm test -- memory-e2e
const liveEnabled = process.env.MEMWAL_LIVE_E2E === "1";
const ownerKey =
  process.env.LIVESTREAK_MEMORY_OWNER_KEY ?? process.env.LIVESTREAK_MEMORY_SUI_OWNER_KEY;

describe.skipIf(!liveEnabled || ownerKey === undefined)(
  "memory host-path e2e (Sui testnet)",
  () => {
    it("provisions a binding on-chain, grants a delegate, and round-trips memory", async () => {
      const config = {
        ...defaultHostServerConfig(),
        walrusNetwork: "testnet" as const,
        memorySuiOwnerPrivateKey: ownerKey ?? null
      };

      const resolved = await resolveWalrus(config);
      expect(resolved.network).toBe("testnet");

      const ops = createMemWalAccountOperations();
      const bindings = createMemoryBindingStore({
        resolved,
        resolveOwnerKey: async () => ownerKey!,
        ops
      });

      const marketId = `e2e-${Date.now()}`;
      const binding = await bindings.provision(marketId);
      expect(binding.memWalAccountId.length).toBeGreaterThan(0);
      expect(binding.namespace).toBe(`market:${marketId}`);

      const delegate = await generateDelegateKey();
      // grantDelegate normalizes + tracks the delegate's PUBLIC KEY hex (64 hex chars).
      const publicKeyHex = Buffer.from(delegate.publicKey).toString("hex");
      await bindings.grantDelegate(marketId, publicKeyHex);
      expect(bindings.hasDelegate(binding.memWalAccountId, publicKeyHex)).toBe(true);

      const namespace = binding.namespace;
      const memwal = MemWal.create({
        key: delegate.privateKey,
        accountId: binding.memWalAccountId,
        serverUrl: resolved.memory.relayerUrl,
        namespace
      });

      const marker = `Flowstream host-path e2e marker ${marketId}`;
      const remembered = await memwal.rememberAndWait(marker, namespace, {
        timeoutMs: 120_000
      });
      expect(remembered.namespace).toBe(namespace);
      expect(remembered.blob_id.length).toBeGreaterThan(0);

      const recalled = await memwal.recall({ query: marker, namespace, limit: 3 });
      expect(recalled.results.length).toBeGreaterThan(0);
      expect(recalled.results[0]?.text).toContain("Flowstream host-path e2e");

      // Public, non-secret proof artifacts for the bring-up record.
      // eslint-disable-next-line no-console
      console.log(
        `[memory-e2e] PROOF ${JSON.stringify({
          network: resolved.network,
          memWalAccountId: binding.memWalAccountId,
          namespace,
          blobId: remembered.blob_id,
          recallTopText: recalled.results[0]?.text
        })}`
      );
    }, 240_000);
  }
);
