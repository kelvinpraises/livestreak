import { describe, expect, it } from "vitest";
import {
  parseMarketIdArg,
  resolveTokenArg
} from "../src/commands/cli-args.js";
import { runFund } from "../src/commands/options.js";

describe("resolveTokenArg", () => {
  it("prefers explicit --token over run.tokenId", () => {
    expect(resolveTokenArg("99", "42")).toBe("99");
  });

  it("falls back to run.tokenId when --token omitted", () => {
    expect(resolveTokenArg(undefined, "42")).toBe("42");
  });

  it("errors loudly when neither --token nor run.tokenId is present", () => {
    expect(() => resolveTokenArg(undefined, undefined)).toThrow(/token required/i);
    expect(() => resolveTokenArg("", "")).toThrow(/token required/i);
  });
});

describe("parseMarketIdArg", () => {
  it("accepts bytes32 market ids", () => {
    const id = `0x${"ab".repeat(32)}`;
    expect(parseMarketIdArg(id)).toBe(id);
  });

  it("rejects malformed market ids", () => {
    expect(() => parseMarketIdArg("0xshort")).toThrow(/bytes32/);
    expect(() => parseMarketIdArg("not-hex")).toThrow(/bytes32/);
  });
});

describe("fund token defaulting contract", () => {
  it("runFund accepts optional token in its input shape", () => {
    const input: Parameters<typeof runFund>[0] = {
      vault: `0x${"aa".repeat(32)}`,
      side: "yes",
      rate: "1",
      deposit: "1"
    };
    expect(input.token).toBeUndefined();
  });
});
