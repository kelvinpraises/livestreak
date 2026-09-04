import { describe, expect, it } from "vitest";
import * as Public from "../src/index.js";

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];

describe("options public exports", () => {
  it("exports model types and helpers", () => {
    expect(publicExport("OptionsVaultSide")).toBeUndefined();
    expect(publicExport("validateOptionsVaultSide")).toBeTypeOf("function");
    expect(publicExport("totalVaultPool")).toBeTypeOf("function");
    expect(publicExport("priceOf")).toBeTypeOf("function");
    expect(publicExport("sharesPerUsdc")).toBeTypeOf("function");
    expect(publicExport("projectShares")).toBeTypeOf("function");
    expect(publicExport("projectStreamAccrual")).toBeTypeOf("function");
    expect(publicExport("segMath")).toBeTypeOf("function");
    expect(publicExport("asMarketId")).toBeTypeOf("function");
    expect(publicExport("asTokenId")).toBeTypeOf("function");
    expect(publicExport("asTxId")).toBeTypeOf("function");
  });

  it("exports chain factory, bridge, and flow reads", () => {
    expect(publicExport("createOptionsChain")).toBeTypeOf("function");
    expect(publicExport("resolveOptionsAccountAddress")).toBeTypeOf("function");
    expect(publicExport("createOptionsBridge")).toBeTypeOf("function");
    expect(publicExport("validateOptionsChainConfig")).toBeTypeOf("function");
    expect(publicExport("readMarketSnapshot")).toBeTypeOf("function");
    expect(publicExport("readVaultSnapshot")).toBeTypeOf("function");
    expect(publicExport("readUserOptionsSnapshot")).toBeTypeOf("function");
    expect(publicExport("readStreamState")).toBeTypeOf("function");
    expect(publicExport("createOptionsRuntime")).toBeTypeOf("function");
    expect(publicExport("validateOptionsRuntimeConfig")).toBeTypeOf("function");
  });

  it("exports panel projection under bridge", () => {
    expect(publicExport("projectOptionsPanel")).toBeTypeOf("function");
    expect(publicExport("projectOptionsControls")).toBeTypeOf("function");
  });

  it("does not export retired reader or standalone write helpers", () => {
    expect(publicExport("createOptionsReader")).toBeUndefined();
    expect(publicExport("OptionsReadTransport")).toBeUndefined();
    expect(publicExport("fundStream")).toBeUndefined();
    expect(publicExport("setLanes")).toBeUndefined();
    expect(publicExport("withdraw")).toBeUndefined();
    expect(publicExport("claimLossLvst")).toBeUndefined();
    expect(publicExport("stakeLvst")).toBeUndefined();
    expect(publicExport("transferNft")).toBeUndefined();
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

  it("exports R3 aggregation helpers", () => {
    expect(publicExport("readSessionPnl")).toBeTypeOf("function");
    expect(publicExport("readClaimsView")).toBeTypeOf("function");
    expect(publicExport("projectSessionPnl")).toBeTypeOf("function");
    expect(publicExport("projectClaimsView")).toBeTypeOf("function");
    expect(publicExport("gatherUserVaultClaims")).toBeTypeOf("function");
  });

  it("does not export stripped media or retired contract ports", () => {
    expect(publicExport("getStreamMedia")).toBeUndefined();
    expect(publicExport("ContractReader")).toBeUndefined();
    expect(publicExport("ContractWriter")).toBeUndefined();
    expect(publicExport("createContractsOptionsReadTransport")).toBeUndefined();
  });
});
