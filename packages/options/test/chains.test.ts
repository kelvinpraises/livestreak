import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asTokenId } from "../src/model/ids.js";
import { createOptionsChain, asTxId } from "../src/chains/index.js";
import { createSuiOptionsChain } from "../src/chains/sui/index.js";
import { createFakeChainWriter, DEFAULT_FAKE_ADDRESSES } from "./helpers/fake-chain.js";

const evmChainConfig = {
  walletInit: {
    chain: "evm" as const,
    seedSource: "raw" as const,
    config: {
      chainId: 31_337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      isSponsored: false,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  },
  seed: "test-seed",
  addresses: DEFAULT_FAKE_ADDRESSES
};

describe("createOptionsChain", () => {
  it("dispatches evm walletInit to an evm chain with reader and writer operations", () => {
    const chain = createOptionsChain(evmChainConfig);

    expect(chain.reader).toBeTypeOf("object");
    expect(chain.writer).toBeTypeOf("object");
    expect(chain.reader.readMarket).toBeTypeOf("function");
    expect(chain.writer.fund).toBeTypeOf("function");
  });

  it("returns TxId from fake writer operations", async () => {
    const writer = createFakeChainWriter();

    const txId = await writer.fund({
      tokenId: asTokenId(1n),
      vaultId:
        "0x00000000000000000000000000000000000000000000000000000000000000aa" as never,
      side: "yes",
      rate: 1n,
      deposit: 1n
    });

    expect(txId).toBe(asTxId("0xfake_user_op_hash"));
  });

  it("dispatches sui walletInit to a stub chain whose operations throw", async () => {
    const chain = createOptionsChain({
      walletInit: {
        chain: "sui",
        seedSource: "raw",
        config: { rpcUrl: "https://fullnode.testnet.sui.io:443" }
      },
      seed: "test-seed",
      addresses: DEFAULT_FAKE_ADDRESSES
    });

    await expect(chain.reader.readMarket("0x01" as never)).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    const suiChain = createSuiOptionsChain();
    await expect(suiChain.writer.fund({} as never)).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("rejects unknown wallet chains", () => {
    expect(() =>
      createOptionsChain({
        walletInit: {
          chain: "nope",
          seedSource: "raw",
          config: {}
        },
        seed: "test-seed",
        addresses: DEFAULT_FAKE_ADDRESSES
      } as never)
    ).toThrow(LiveStreakConfigError);
  });
});
