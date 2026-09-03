import { describe, expect, it } from "vitest";
import { MemWal } from "@mysten-incubation/memwal";
import {
  createAccount,
  addDelegateKey,
  generateDelegateKey
} from "@mysten-incubation/memwal/account";
import { fetchRelayerConfig, walrusNetworkProfiles } from "#infrastructure/walrus/network.js";

const liveEnabled = process.env.MEMWAL_LIVE === "1";
const ownerKey =
  process.env.LIVESTREAK_MEMORY_OWNER_KEY ?? process.env.LIVESTREAK_MEMORY_SUI_OWNER_KEY;
const network =
  process.env.LIVESTREAK_WALRUS_NETWORK === "mainnet" ? "mainnet" : "testnet";

describe.skipIf(!liveEnabled || ownerKey === undefined)(
  "memory live integration",
  () => {
    it("provisions, grants, remembers, and recalls via the hosted relayer", async () => {
      const profile = walrusNetworkProfiles[network];
      const relayerUrl =
        process.env.LIVESTREAK_WALRUS_MEMORY_RELAYER_URL_OVERRIDE ?? profile.memory.relayerUrl;
      const deployment = await fetchRelayerConfig(relayerUrl);
      const registryId =
        process.env.LIVESTREAK_WALRUS_REGISTRY_ID_OVERRIDE ??
        deployment.registryId ??
        profile.memory.registryId;
      const delegate = await generateDelegateKey();
      const namespace = `livestreak-host-m1-${Date.now()}`;

      const created = await createAccount({
        packageId: deployment.packageId,
        registryId,
        suiPrivateKey: ownerKey!,
        suiNetwork: deployment.network
      });

      expect(created.accountId.length).toBeGreaterThan(0);

      await addDelegateKey({
        packageId: deployment.packageId,
        accountId: created.accountId,
        publicKey: delegate.publicKey,
        label: "livestreak-host-m1",
        suiPrivateKey: ownerKey!,
        suiNetwork: deployment.network
      });

      const memwal = MemWal.create({
        key: delegate.privateKey,
        accountId: created.accountId,
        serverUrl: relayerUrl,
        namespace
      });

      const remembered = await memwal.rememberAndWait(
        "Flowstream host memory-live integration marker",
        namespace,
        { timeoutMs: 120_000 }
      );

      expect(remembered.namespace).toBe(namespace);

      const recalled = await memwal.recall({
        query: "Flowstream host memory-live integration marker",
        namespace,
        limit: 3
      });

      expect(recalled.results.length).toBeGreaterThan(0);
      expect(recalled.results[0]?.text).toContain("Flowstream host memory-live");
    });
  }
);
