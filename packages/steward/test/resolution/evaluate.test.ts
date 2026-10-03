import { expect, it } from "vitest";
import { assessResolution } from "../../src/workflow/resolution/evaluate.js";
import { fixtureEvidence } from "../../../schema/test/helpers/resolution.js";
import { fixtureMandate } from "../../../schema/test/helpers/mandate.js";
it("replays exact threshold and explicit tie independently; execution delay does not stale the event", async () => {
  const m = fixtureMandate();
  const e = await fixtureEvidence();
  expect(
    (await assessResolution(m, [e], 2000000099, "yes", "Final score above 2")).outcome,
  ).toBe("yes");
  await expect(assessResolution(m, [e], 2000000050, "no", "Wrong side")).rejects.toThrow(
    "disagrees",
  );
  const tie = await fixtureEvidence({
    payload: JSON.stringify({ field: "score", units: "points", value: "2" }),
  });
  expect((await assessResolution(m, [tie], 2000000050, "no", "Tie is NO")).outcome).toBe(
    "no",
  );
});
it("rejects wrong source, units and noncanonical samples instead of coercing", async () => {
  const m = fixtureMandate();
  await expect(
    assessResolution(
      m,
      [await fixtureEvidence({ sourceId: "other" })],
      2000000050,
      "yes",
      "Reason",
    ),
  ).rejects.toThrow("not permitted");
  await expect(
    assessResolution(
      m,
      [
        await fixtureEvidence({
          payload: JSON.stringify({ field: "score", units: "usd", value: "3" }),
        }),
      ],
      2000000050,
      "yes",
      "Reason",
    ),
  ).rejects.toThrow("units");
});
it("keeps missing, conflicting, outside-window and expired evidence pending", async () => {
  const m = fixtureMandate(),
    e = await fixtureEvidence();
  expect((await assessResolution(m, [], 2000000050, "yes", "Reason")).outcome).toBe(
    "pending",
  );
  expect(
    (
      await assessResolution(
        m,
        [e, await fixtureEvidence({ payload: "different" })],
        2000000050,
        "yes",
        "Reason",
      )
    ).outcome,
  ).toBe("pending");
  expect(
    (
      await assessResolution(
        m,
        [await fixtureEvidence({ observedAt: 1999999999 })],
        2000000050,
        "yes",
        "Reason",
      )
    ).outcome,
  ).toBe("pending");
  expect((await assessResolution(m, [e], 2000000101, "yes", "Reason")).reason).toContain(
    "No guaranteed refund",
  );
});
it("requires explicit judgement and nonempty reason under the disclosed rubric", async () => {
  const m = {
    ...fixtureMandate(),
    method: "discretionary" as const,
    evaluation: {
      kind: "rubric" as const,
      rubric: "Read the complete official score record",
    },
  };
  const e = await fixtureEvidence();
  await expect(assessResolution(m, [e], 2000000050, undefined, "Reason")).rejects.toThrow(
    "explicit",
  );
  await expect(assessResolution(m, [e], 2000000050, "yes", "")).rejects.toThrow("reason");
  expect(
    (await assessResolution(m, [e], 2000000050, "no", "Rubric judgement from cited score"))
      .outcome,
  ).toBe("no");
});
