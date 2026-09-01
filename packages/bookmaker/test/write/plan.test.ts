import { describe, expect, it } from "vitest";
import { planBookmakerWrite } from "../../src/write/plan.js";
import { detection, vaultDraft } from "../helpers/fixtures.js";

describe("planBookmakerWrite", () => {
  const contracts = {
    vaultAddress: "0x00000000000000000000000000000000000000aa"
  } as const;

  const detected = detection();
  const draft = vaultDraft();

  it("plans createVault under marketId", () => {
    const plan = planBookmakerWrite(
      {
        action: "createVault",
        draft,
        detection: detected
      },
      contracts
    );

    expect(plan.intents).toEqual([
      {
        action: "createVault",
        marketId: "market-1",
        draft
      }
    ]);
  });

  it("plans joinExistingVault when decision joins", () => {
    const plan = planBookmakerWrite(
      {
        action: "joinVault",
        vaultId: "vault-9",
        draft,
        detection: detected
      },
      contracts
    );

    expect(plan.intents).toEqual([
      {
        action: "joinExistingVault",
        marketId: "market-1",
        vaultId: "vault-9",
        draft
      }
    ]);
  });

  it("does not emit any market registration intent", () => {
    const plan = planBookmakerWrite(
      {
        action: "createVault",
        draft,
        detection: detected
      },
      contracts
    );

    expect(plan.intents.some((intent) => intent.action === "registerMarket" as never)).toBe(false);
    expect(plan.intents.every((intent) => intent.action === "createVault" || intent.action === "joinExistingVault")).toBe(
      true
    );
  });

  it("returns no intents for skip decisions", () => {
    const plan = planBookmakerWrite(
      {
        action: "skip",
        reason: "duplicate_vault",
        detection: detected
      },
      contracts
    );

    expect(plan.intents).toEqual([]);
  });
});
