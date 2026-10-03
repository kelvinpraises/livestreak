import type { VaultMandate } from "../../src/mandate.js";
export const fixtureMandate = (marketId = `0x${"12".repeat(32)}`, question = "Will the published score exceed 2?"): VaultMandate => ({
  version:"livestreak-mandate/1",chainId:"eip155:31337",marketId,question,
  yesMeaning:"The eligible official score is above 2",noMeaning:"The eligible official score is at most 2",
  method:"deterministic",evaluation:{kind:"numeric-threshold",sourceId:"official-score",field:"score",units:"points",comparator:">",threshold:"2",tie:"no"},
  evidence:[{sourceId:"official-score",kind:"record",description:"Published final score; source identity and publication time must be checked"}],
  authority:"market-designated-steward",authorityChanges:"registry-authority-may-change",
  fundingClose:2000000000,decisionStart:2000000000,decisionEnd:2000000100,
  missingEvidence:{deadline:2000000200,treatment:"unresolved-escalate-no-guaranteed-refund",procedure:"At deadline remain unresolved, alert the Steward; no guaranteed refund is promised"},
  ambiguityProcedure:"Record conflicting official reports and escalate at the declared deadline; never default an answer"
});
