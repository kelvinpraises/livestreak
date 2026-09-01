import { describe, expect, it } from "vitest";
import * as Public from "../src/index.js";

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];

describe("options public exports", () => {
  it("exports model types and helpers", () => {
    expect(publicExport("OptionsVaultSide")).toBeUndefined();
    expect(publicExport("validateOptionsVaultSide")).toBeTypeOf("function");
    expect(publicExport("totalVaultPool")).toBeTypeOf("function");
    expect(publicExport("asMarketId")).toBeTypeOf("function");
  });

  it("exports read transport type surface and read helpers", () => {
    expect(publicExport("readMarketSnapshot")).toBeTypeOf("function");
    expect(publicExport("readVaultSnapshot")).toBeTypeOf("function");
    expect(publicExport("readUserOptionsSnapshot")).toBeTypeOf("function");
    expect(publicExport("createContractsOptionsReadTransport")).toBeTypeOf("function");
    expect(publicExport("createOptionsRuntime")).toBeTypeOf("function");
    expect(publicExport("validateOptionsRuntimeConfig")).toBeTypeOf("function");
  });

  it("exports panel projection", () => {
    expect(publicExport("projectOptionsPanel")).toBeTypeOf("function");
  });

  it("exports write transport and write helpers", () => {
    expect(publicExport("createContractsOptionsWriteTransport")).toBeTypeOf("function");
    expect(publicExport("setFundingRate")).toBeTypeOf("function");
    expect(publicExport("stopFundingStream")).toBeTypeOf("function");
    expect(publicExport("claimLossFlow")).toBeTypeOf("function");
    expect(publicExport("stakeFlow")).toBeTypeOf("function");
    expect(publicExport("unstakeFlow")).toBeTypeOf("function");
  });

  it("does not export blocked write functions", () => {
    expect(publicExport("claimVault")).toBeUndefined();
    expect(publicExport("releaseVault")).toBeUndefined();
    expect(publicExport("claimFlowDividends")).toBeUndefined();
    expect(publicExport("claimAndStakeLossFlow")).toBeUndefined();
  });

  it("does not export fake test helpers or internal stores", () => {
    expect(publicExport("createFakeOptionsReadTransport")).toBeUndefined();
    expect(publicExport("FakeTransportInMemory")).toBeUndefined();
    expect(publicExport("OptionsRuntime")).toBeUndefined();
  });

  it("does not export vault or market creation APIs", () => {
    expect(publicExport("createVault")).toBeUndefined();
    expect(publicExport("createMarket")).toBeUndefined();
    expect(publicExport("registerMarket")).toBeUndefined();
  });
});
