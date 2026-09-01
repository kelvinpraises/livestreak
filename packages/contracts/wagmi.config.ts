import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "generated/contracts.ts",
  plugins: [
    foundry({
      project: ".",
      include: [
        "MarketRegistry.sol/MarketRegistry.json",
        "BookmakerRegistry.sol/BookmakerRegistry.json",
        "VaultFactory.sol/VaultFactory.json",
        "Vault.sol/Vault.json",
        "LvstToken.sol/LvstToken.json",
        "StewardRegistry.sol/StewardRegistry.json",
        "DripsStreaming.sol/DripsStreaming.json",
        "IDrips.sol/IDrips.json",
        "Caller.sol/Caller.json",
        "AddressDriver.sol/AddressDriver.json",
        "LiveStreakPaymaster.sol/LiveStreakPaymaster.json"
      ]
    })
  ]
});
