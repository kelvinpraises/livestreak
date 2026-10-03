import { expect, it } from "vitest";
import {
  canonicalResolutionBytes,
  resolutionDigest,
  verifyResolutionRecord,
} from "../src/index.js";
import { fixtureResolution } from "./helpers/resolution.js";
it("round-trips immutable canonical evidence and rejects digest/payload changes", async () => {
  const r = await fixtureResolution(),
    d = await resolutionDigest(r);
  expect(await verifyResolutionRecord(r, d)).toEqual(r);
  expect(await resolutionDigest({ ...r, reason: "Different reason" })).not.toBe(d);
  await expect(
    verifyResolutionRecord({ ...r, reason: "Different reason" }, d),
  ).rejects.toThrow("digest mismatch");
  await expect(
    verifyResolutionRecord({
      ...r,
      evidence: [{ ...r.evidence[0], payload: "fabricated" }],
    }),
  ).rejects.toThrow("payload digest");
});
it("rejects impossible provenance, unknown fields, empty successful evidence and oversized records", async () => {
  const r = await fixtureResolution();
  expect(() => canonicalResolutionBytes({ ...r, extra: 1 })).toThrow();
  expect(() => canonicalResolutionBytes({ ...r, evidence: [] })).toThrow();
  expect(() =>
    canonicalResolutionBytes({
      ...r,
      evidence: [{ ...r.evidence[0], retrievedAt: 2000000000 }],
    }),
  ).toThrow();
  expect(() =>
    canonicalResolutionBytes({
      ...r,
      evidence: [{ ...r.evidence[0], payload: "a".repeat(16385) }],
    }),
  ).toThrow();
  expect(() =>
    canonicalResolutionBytes({ ...r, outcome: "pending", evidence: [] }),
  ).not.toThrow();
});
