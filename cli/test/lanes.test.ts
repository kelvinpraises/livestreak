import { describe, expect, it } from "vitest";
import { bridgeActionScope } from "@livestreak/options";
import {
  parseLaneSpec,
  parseLaneSpecs,
  parseVaultIdList
} from "../src/commands/args.js";
import { buildSetLanesEnvelope } from "../src/commands/lanes.js";

const vaultA = `0x${"aa".repeat(32)}`;
const vaultB = `0x${"bb".repeat(32)}`;

describe("cli-args lane parsing", () => {
  it("parses vaultId:side:rate into LaneWriteInput", () => {
    const lane = parseLaneSpec(`${vaultA}:yes:1000`);
    expect(lane.vaultId).toBe(vaultA);
    expect(lane.side).toBe("yes");
    expect(lane.rate).toBe(1000n);
  });

  it("rejects malformed lane specs", () => {
    expect(() => parseLaneSpec("only-two:parts")).toThrow(/vaultId:side:rate/);
    expect(() => parseLaneSpecs([])).toThrow(/at least one/);
    expect(() => parseLaneSpec(`${vaultA}:maybe:1`)).toThrow();
  });
});

describe("set-lanes envelope", () => {
  it("builds setLanes with parsed lanes", () => {
    const envelope = buildSetLanesEnvelope(1n, [`${vaultA}:yes:10`, `${vaultB}:no:20`], 0n);
    expect(envelope.scope).toBe(bridgeActionScope);
    expect(envelope.action).toBe("setLanes");
    expect(envelope.args).toMatchObject({
      tokenId: 1n,
      addDeposit: 0n
    });
    const args = envelope.args as { lanes: Array<{ side: string; rate: bigint }> };
    expect(args.lanes).toHaveLength(2);
    expect(args.lanes[0]?.side).toBe("yes");
    expect(args.lanes[1]?.side).toBe("no");
  });

  it("includes addDeposit in the setLanes envelope", () => {
    const envelope = buildSetLanesEnvelope(1n, [`${vaultA}:yes:10`], 500n);
    expect((envelope.args as { addDeposit: bigint }).addDeposit).toBe(500n);
  });
});

describe("withdraw-many vault list", () => {
  it("parses comma-separated vault ids", () => {
    expect(parseVaultIdList(`${vaultA},${vaultB}`)).toEqual([vaultA, vaultB]);
  });
});
