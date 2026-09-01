import { describe, expect, it } from "vitest";
import { findSimilar } from "../../src/similarity/find.js";
import { chooseVaultAction } from "../../src/decision/choose.js";
import { createFakeSimilarityClient, createRejectingSimilarityClient } from "../helpers/fake-similarity-client.js";
import { detection, similarityResult, vaultDraft } from "../helpers/fixtures.js";

describe("findSimilar", () => {
  const draft = vaultDraft();
  const detected = detection();

  it("delegates to the injected client with the draft marketId", async () => {
    const configured = similarityResult({
      candidates: [
        {
          kind: "vault",
          vaultId: "vault-1",
          marketId: "market-1",
          score: 0.7,
          reason: "similar",
          suggestedAction: "create-new"
        }
      ]
    });
    const client = createFakeSimilarityClient(configured);

    await expect(findSimilar(draft, client)).resolves.toEqual(configured);
  });

  it("propagates client rejection to the caller", async () => {
    const client = createRejectingSimilarityClient(new Error("host down"));

    await expect(findSimilar(draft, client)).rejects.toThrow("host down");
  });

  it("skips on high duplicate risk with skip-on-high policy", async () => {
    const similarity = await findSimilar(
      draft,
      createFakeSimilarityClient(similarityResult({ duplicateRisk: "high" }))
    );
    const decision = chooseVaultAction(draft, similarity, {
      duplicatePolicy: "skip-on-high",
      detection: detected
    });

    expect(decision).toEqual({
      action: "skip",
      reason: "duplicate_vault",
      detection: detected
    });
  });

  it("joins when a join-existing candidate clears the threshold", async () => {
    const similarity = await findSimilar(
      draft,
      createFakeSimilarityClient(
        similarityResult({
          candidates: [
            {
              kind: "vault",
              vaultId: "vault-9",
              marketId: "market-1",
              score: 0.92,
              reason: "near-duplicate",
              suggestedAction: "join-existing"
            }
          ]
        })
      )
    );
    const decision = chooseVaultAction(draft, similarity, {
      duplicatePolicy: "prefer-join",
      detection: detected
    });

    expect(decision).toEqual({
      action: "joinVault",
      vaultId: "vault-9",
      draft,
      detection: detected
    });
  });

  it("creates when no join candidate exists", async () => {
    const similarity = await findSimilar(draft, createFakeSimilarityClient(similarityResult()));
    const decision = chooseVaultAction(draft, similarity, {
      duplicatePolicy: "always-create",
      detection: detected
    });

    expect(decision).toEqual({
      action: "createVault",
      draft,
      detection: detected
    });
  });

  it("skips on steward warnings", async () => {
    const similarity = await findSimilar(
      draft,
      createFakeSimilarityClient(
        similarityResult({ stewardWarnings: ["rogue bookmaker pattern"] })
      )
    );
    const decision = chooseVaultAction(draft, similarity, {
      duplicatePolicy: "always-create",
      detection: detected
    });

    expect(decision).toEqual({
      action: "skip",
      reason: "steward_warning",
      detection: detected
    });
  });
});
