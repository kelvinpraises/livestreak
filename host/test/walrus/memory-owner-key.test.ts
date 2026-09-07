import { describe, expect, it } from "vitest";
import { resolveMemoryOwnerKey } from "#infrastructure/wallet/index.js";

// Regression: a directly-injected Sui owner private key (the testnet deployer
// key in LIVESTREAK_MEMORY_OWNER_KEY) must be accepted on its own, without a
// wallet/owner seed. Previously the resolver demanded a seed unconditionally
// and threw memory_owner_not_configured even when the key was present.
describe("resolveMemoryOwnerKey", () => {
  it("returns a directly-injected private key without requiring a seed", async () => {
    const injected = "suiprivkey1qqexampledirectkeyplaceholdervalue";
    const key = await resolveMemoryOwnerKey(
      {
        walletSeed: null,
        memoryOwnerSeed: null,
        memorySuiOwnerPrivateKey: injected
      },
      "https://fullnode.testnet.sui.io:443"
    );

    expect(key).toBe(injected);
  });

  it("throws when neither a key nor a seed is configured", async () => {
    await expect(
      resolveMemoryOwnerKey(
        { walletSeed: null, memoryOwnerSeed: null, memorySuiOwnerPrivateKey: null },
        "https://fullnode.testnet.sui.io:443"
      )
    ).rejects.toThrow(/memory_owner_not_configured/u);
  });
});
