import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";
import {
  OUTCOME_SOLIDITY,
  encodeResolveVaultCall,
  outcomeToSolidityValue,
  parseOutcomeArg,
  resolveStewardKey,
  resolveVaultEvm
} from "../src/adapters/steward.js";

const vaultId = `0x${"ab".repeat(32)}` as `0x${string}`;
const stewardRegistry = "0x0000000000000000000000000000000000000abc" as `0x${string}`;

// pollUntilUserOperationIncluded reaches out to a bundler; stub it so the runtime is mocked.
vi.mock("@livestreak/wallet", async (importActual) => {
  const actual = await importActual<typeof import("@livestreak/wallet")>();
  return { ...actual, pollUntilUserOperationIncluded: vi.fn(async () => undefined) };
});

describe("steward resolve — outcome parsing", () => {
  it("parses yes/no case-insensitively and rejects junk", () => {
    expect(parseOutcomeArg("yes")).toBe("yes");
    expect(parseOutcomeArg(" NO ")).toBe("no");
    expect(() => parseOutcomeArg("maybe")).toThrow(/yes.*no/i);
    expect(() => parseOutcomeArg("")).toThrow();
  });

  it("maps outcomes to the Vault.Outcome enum (yes=1, no=2)", () => {
    expect(outcomeToSolidityValue("yes")).toBe(OUTCOME_SOLIDITY.yes);
    expect(outcomeToSolidityValue("no")).toBe(OUTCOME_SOLIDITY.no);
    expect(OUTCOME_SOLIDITY).toEqual({ pending: 0, yes: 1, no: 2 });
  });
});

describe("steward resolve — calldata", () => {
  it("encodes resolveVault against the live steward registry ABI and round-trips", () => {
    const data = encodeResolveVaultCall(vaultId, "yes");
    const decoded = decodeFunctionData({ abi: stewardRegistryAbi, data });
    expect(decoded.functionName).toBe("resolveVault");
    expect(decoded.args?.[0]).toBe(vaultId);
    expect(decoded.args?.[1]).toBe(1);
  });

  it("encodes the losing outcome as 2", () => {
    const decoded = decodeFunctionData({
      abi: stewardRegistryAbi,
      data: encodeResolveVaultCall(vaultId, "no")
    });
    expect(decoded.args?.[1]).toBe(2);
  });
});

describe("steward resolve — EVM dispatch (signs as the steward identity)", () => {
  it("signs resolveVault to the steward registry via the injected steward signer and returns the hash", async () => {
    const resolve = vi.fn(async () => "0xdeadbeef");
    const signer = { resolve };

    const tx = await resolveVaultEvm({ signer, stewardRegistry, vaultId, outcome: "yes" });

    expect(tx).toBe("0xdeadbeef");
    expect(resolve).toHaveBeenCalledTimes(1);
    const call = resolve.mock.calls[0][0] as { stewardRegistry: string; data: string };
    expect(call.stewardRegistry).toBe(stewardRegistry);
    const decoded = decodeFunctionData({ abi: stewardRegistryAbi, data: call.data as `0x${string}` });
    expect(decoded.functionName).toBe("resolveVault");
    expect(decoded.args?.[1]).toBe(1);
  });
});

describe("steward resolve — key sourcing (no baked secrets)", () => {
  it("prefers LIVESTREAK_STEWARD_KEY and falls back to the public anvil key only on 31337", async () => {
    const prev = process.env["LIVESTREAK_STEWARD_KEY"];
    delete process.env["LIVESTREAK_STEWARD_KEY"];
    expect(resolveStewardKey(31337)).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(() => resolveStewardKey(1)).toThrow(/steward key required/i);
    process.env["LIVESTREAK_STEWARD_KEY"] = "abc123";
    expect(resolveStewardKey(1)).toBe("0xabc123");
    if (prev === undefined) {
      delete process.env["LIVESTREAK_STEWARD_KEY"];
    } else {
      process.env["LIVESTREAK_STEWARD_KEY"] = prev;
    }
  });
});
