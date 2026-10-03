import { describe, expect, it } from "vitest";
import { canonicalMandateBytes, mandateCommitment, verifyMandate } from "../src/mandate.js";
import { fixtureMandate } from "./helpers/mandate.js";
describe("generic immutable mandate", () => {
  it("rejects enum objects instead of coercing them into canonical strings", () => {
    const mandate = fixtureMandate();
    expect(() => canonicalMandateBytes({ ...mandate, evaluation: { ...mandate.evaluation, comparator: { toString: () => ">" } } })).toThrow();
    expect(() => canonicalMandateBytes({ ...mandate, evidence: [{ ...mandate.evidence[0], kind: { toString: () => "record" } }] })).toThrow();
  });
  it("accepts mixed evaluation and enforces the total document byte limit", () => {
    const mandate = fixtureMandate();
    expect(canonicalMandateBytes({ ...mandate, method: "mixed", evaluation: { kind: "mixed", rubric: "Use the explicit threshold and explain eligibility", checks: [mandate.evaluation] } }).length).toBeGreaterThan(0);
    expect(() => canonicalMandateBytes({ ...mandate, evidence: Array.from({ length: 16 }, (_, i) => ({ sourceId: i === 0 ? "official-score" : `record-${i}`, kind: "record", description: "x".repeat(4096) })) })).toThrow("32 KiB");
  });
  it("has identical canonical bytes across ordering, independently verifiable binding", async () => {
    const mandate=fixtureMandate();const reverse=Object.fromEntries(Object.entries(mandate).reverse());
    expect(canonicalMandateBytes(reverse)).toEqual(canonicalMandateBytes(mandate));
    const commitment=await mandateCommitment(canonicalMandateBytes(mandate));
    const terms={...mandate,vaultId:"vault",commitment};
    expect(await verifyMandate(reverse,terms)).toEqual(mandate);
    for (const mismatch of [{marketId:"another"},{chainId:"eip155:1"},{question:"changed"},{fundingClose:mandate.fundingClose+1},{commitment:`0x${"00".repeat(32)}`}])
      await expect(verifyMandate(mandate,{...terms,...mismatch})).rejects.toThrow();
  });
  it("accepts disclosed discretion without any oracle/provider field", () => {
    const mandate={...fixtureMandate(),method:"discretionary",evaluation:{kind:"rubric",rubric:"YES only when the eligible clip visibly contains two completed jumps; explain any ambiguity"}};
    expect(canonicalMandateBytes(mandate).length).toBeGreaterThan(0);
  });
  it.each([
    {fundingClose:2000000000000}, {decisionStart:1}, {authority:"bookmaker"}, {feedId:"pyth"},
    {question:""}, {question:"\ud800"}, {evaluation:{kind:"rubric",rubric:"ambiguous"}},
    {missingEvidence:{deadline:2000000200,treatment:"automatic-refund",procedure:"promise"}},
    {evidence:[]}, {question:"a".repeat(4097)}
  ])("rejects malformed/unsupported terms %j", change => {
    expect(()=>canonicalMandateBytes({...fixtureMandate(),...change})).toThrow();
  });
  it("detects edits even when a caller claims the old commitment", async () => {
    const original=fixtureMandate();const commitment=await mandateCommitment(canonicalMandateBytes(original));
    await expect(verifyMandate({...original,yesMeaning:"opposite answer"},{...original,vaultId:"v",commitment})).rejects.toThrow();
  });
});
