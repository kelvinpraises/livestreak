import { describe, expect, it } from "vitest";
import {
  contractsWriteSurfaceAvailable,
  hasContractsWriteSurface,
  mapCreateVaultIntentToDescriptor,
  mapExecutableIntentsToDescriptors,
  partitionWriteIntents
} from "../../src/write/contracts-boundary.js";
import { planBookmakerWrite } from "../../src/write/plan.js";
import { detection, vaultDraft } from "../helpers/fixtures.js";

describe("contracts write boundary", () => {
  const contracts = {
    vaultAddress: "0x00000000000000000000000000000000000000aa"
  } as const;

  const marketIdBytes = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
  const detected = detection();
  const draft = vaultDraft();

  it("tracks contracts TS encoder availability separately from deployment surface", () => {
    expect(contractsWriteSurfaceAvailable()).toBe(false);
    expect(hasContractsWriteSurface(contracts)).toBe(true);
    expect(hasContractsWriteSurface({})).toBe(false);
  });

  it("maps createVault intents to descriptor data without ABI fragments", () => {
    const plan = planBookmakerWrite(
      { action: "createVault", draft, detection: detected },
      contracts
    );
    const descriptor = mapCreateVaultIntentToDescriptor(partitionWriteIntents(plan).executable[0]!, {
      marketIdBytes
    });

    expect(descriptor).toEqual({
      kind: "write",
      contract: "VaultFactory",
      functionName: "createVault",
      args: {
        marketIdBytes,
        question: draft.question
      }
    });
    expect(descriptor).not.toHaveProperty("abi");
  });

  it("keeps joinExistingVault as intent-only with no contract descriptor", () => {
    const plan = planBookmakerWrite(
      { action: "joinVault", vaultId: "vault-9", draft, detection: detected },
      contracts
    );
    const { executable, intentOnly } = partitionWriteIntents(plan);

    expect(executable).toEqual([]);
    expect(intentOnly).toHaveLength(1);
    expect(mapExecutableIntentsToDescriptors(plan, { marketIdBytes })).toEqual([]);
  });

  it("never maps registerMarket descriptors", () => {
    const plan = planBookmakerWrite(
      { action: "createVault", draft, detection: detected },
      contracts
    );
    const descriptors = mapExecutableIntentsToDescriptors(plan, { marketIdBytes });

    expect(descriptors.every((descriptor) => descriptor.functionName !== "registerMarket")).toBe(true);
  });
});
