import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { DEFAULT_EVM_CAIP2, DEFAULT_HOST_URL, SettingsDoc } from "../src/settings.js";

describe("SettingsDoc", () => {
  it("decodes a minimal localhost settings shape", () => {
    const doc = Schema.decodeUnknownSync(SettingsDoc)({
      host: { url: DEFAULT_HOST_URL },
      defaultChain: DEFAULT_EVM_CAIP2,
      chains: {
        [DEFAULT_EVM_CAIP2]: {
          deployment: "@livestreak/contracts/evm/deployments/localhost",
          rpc: "http://127.0.0.1:8545",
          contracts: { marketRegistry: "0x24599b53386dbe94dc7acb48dd5815ff51416683" },
          wallet: { keystoreSlot: "evm-localhost" }
        }
      }
    });
    expect(doc.defaultChain).toBe(DEFAULT_EVM_CAIP2);
  });
});
