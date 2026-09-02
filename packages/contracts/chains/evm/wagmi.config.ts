import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "generated/abis.ts",
  plugins: [
    foundry({
      project: ".",
      include: [
        "Protocol.sol/Protocol.json",
        "MarketRegistry.sol/MarketRegistry.json",
        "Vault.sol/Vault.json",
        "LvstToken.sol/LvstToken.json",
        "Treasury.sol/Treasury.json",
        "StewardRegistry.sol/StewardRegistry.json",
        "DripsStreaming.sol/DripsStreaming.json",
        "IDrips.sol/IDrips.json",
        "Caller.sol/Caller.json",
        "MarketDriver.sol/MarketDriver.json",
        "VaultDriver.sol/VaultDriver.json",
        "LiveStreakPaymaster.sol/LiveStreakPaymaster.json"
      ]
    })
  ]
});
