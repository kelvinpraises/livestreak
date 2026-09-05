import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { Address, EvmWalletInitConfig } from "../src/wallet.js";

const decodeAddress = Schema.decodeUnknownEither(Address);

const baseEvm = {
  chainId: 1,
  provider: "https://rpc",
  bundlerUrl: "https://bundler",
  useNativeCoins: false,
  entryPointAddress: "0x0000000000000000000000000000000000000001",
  safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
  safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
  safeModulesVersion: "0.3.0",
  contractNetworks: {}
};
const decodeEvm = Schema.decodeUnknownEither(EvmWalletInitConfig);

describe("SCH.2 — Address brand + pattern", () => {
  it("accepts a 0x+40-hex address (any case)", () => {
    expect(Either.isRight(decodeAddress("0xABCDEF0123456789abcdef0123456789ABCDEF01"))).toBe(true);
  });

  it("rejects non-hex, wrong length, and Sui 0x+64-hex ids", () => {
    expect(Either.isLeft(decodeAddress("0xnothex"))).toBe(true);
    expect(Either.isLeft(decodeAddress("0x1234"))).toBe(true);
    expect(Either.isLeft(decodeAddress(`0x${"a".repeat(64)}`))).toBe(true);
  });
});

describe("SCH.1 — sponsored config requires paymasterUrl", () => {
  it("isSponsored:true WITHOUT paymasterUrl fails at decode", () => {
    expect(Either.isLeft(decodeEvm({ ...baseEvm, isSponsored: true }))).toBe(true);
  });

  it("isSponsored:true WITH paymasterUrl decodes", () => {
    expect(
      Either.isRight(decodeEvm({ ...baseEvm, isSponsored: true, paymasterUrl: "https://pm" }))
    ).toBe(true);
  });

  it("isSponsored:false WITHOUT paymasterUrl decodes (self-pay/native)", () => {
    expect(Either.isRight(decodeEvm({ ...baseEvm, isSponsored: false }))).toBe(true);
  });
});
