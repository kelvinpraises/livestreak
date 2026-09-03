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

  it("exports NFT-lane write transport and write helpers", () => {
    expect(publicExport("createContractsOptionsWriteTransport")).toBeTypeOf("function");
    expect(publicExport("fundStream")).toBeTypeOf("function");
    expect(publicExport("setLanes")).toBeTypeOf("function");
    expect(publicExport("stopFunding")).toBeTypeOf("function");
    expect(publicExport("stopAllFunding")).toBeTypeOf("function");
    expect(publicExport("withdraw")).toBeTypeOf("function");
    expect(publicExport("withdrawMany")).toBeTypeOf("function");
    expect(publicExport("claimLossLvst")).toBeTypeOf("function");
    expect(publicExport("stakeLvst")).toBeTypeOf("function");
    expect(publicExport("unstakeLvst")).toBeTypeOf("function");
    expect(publicExport("claimDividends")).toBeTypeOf("function");
    expect(publicExport("transferNft")).toBeTypeOf("function");
    expect(publicExport("approveNft")).toBeTypeOf("function");
    expect(publicExport("setApprovalForAll")).toBeTypeOf("function");
  });

  it("does not export retired R1 write names", () => {
    expect(publicExport("setFundingRate")).toBeUndefined();
    expect(publicExport("stopFundingStream")).toBeUndefined();
    expect(publicExport("claimLossFlow")).toBeUndefined();
    expect(publicExport("stakeFlow")).toBeUndefined();
    expect(publicExport("unstakeFlow")).toBeUndefined();
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

  it("does not export R3 deferred names", () => {
    expect(publicExport("createOptionsMemoryFacade")).toBeUndefined();
    expect(publicExport("projectTransferPanel")).toBeUndefined();
  });

  it("exports R3 aggregation and runtime helpers", () => {
    expect(publicExport("readSessionPnl")).toBeTypeOf("function");
    expect(publicExport("readClaimsView")).toBeTypeOf("function");
    expect(publicExport("projectSessionPnl")).toBeTypeOf("function");
    expect(publicExport("projectClaimsView")).toBeTypeOf("function");
    expect(publicExport("gatherUserVaultClaims")).toBeTypeOf("function");
  });

  it("exports consumer media read helpers", () => {
    expect(publicExport("getStreamMedia")).toBeTypeOf("function");
    expect(publicExport("resolveStreamMedia")).toBeTypeOf("function");
    expect(publicExport("DEFAULT_MEDIA_RESOLVERS")).toBeTypeOf("object");
    expect(publicExport("walrusAggregatorResolver")).toBeTypeOf("function");
    expect(publicExport("OptionsStreamMedia")).toBeUndefined();
    expect(publicExport("SCHEME_GATEWAY")).toBeUndefined();
    expect(publicExport("GatewayOverrides")).toBeUndefined();
  });
});
