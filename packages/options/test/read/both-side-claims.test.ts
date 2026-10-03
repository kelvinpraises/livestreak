import { expect, it } from "vitest";
import { gatherUserVaultClaims } from "../../src/flows/claims.js";
import { createFakeOptionsReader } from "../helpers/fake-chain.js";
import { asTokenId, asVaultId, asMarketId, asUserAddress } from "../../src/model/ids.js";
it("preserves both sides of an owned resolved vault and does not re-advertise a claimed loss", async () => {
  const reader = createFakeOptionsReader(),
    owner = asUserAddress("viewer"),
    vid = asVaultId("vault");
  reader.listOwnerTokens = async () => [asTokenId(1n)];
  reader.readAccountVaultIds = async () => [vid];
  reader.readVault = async () => ({
    vaultId: vid,
    marketId: asMarketId("market"),
    question: "Question",
    type: "threshold",
    creator: "other",
    status: "resolved",
    outcome: "yes",
    pools: { yes: 1n, no: 1n },
    timing: { createdAtMs: 1, expiresAtMs: 2 },
    steward: { hot: false },
  });
  reader.readWinningSide = async () => "yes";
  reader.readNft = async () => ({
    tokenId: asTokenId(1n),
    owner,
    marketId: asMarketId("market"),
    laneCount: 2,
    lanes: ["yes", "no"].map((side) => ({
      tokenId: asTokenId(1n),
      vaultId: vid,
      side: side as "yes" | "no",
      rate: 0n,
      committedRate: 0n,
      gPaid: 0n,
      sharesAccrued: 1n,
      depleted: true,
      claimable: side === "yes" ? 3n : 0n,
      lossClaimable: side === "no" ? 2n : 0n,
      lossClaimed: side === "no",
    })),
  });
  const rows = await gatherUserVaultClaims(reader, owner);
  expect(rows.map((r) => r.side)).toEqual(["yes", "no"]);
  expect(rows[0]?.claimable).toBe(3n);
  expect(rows[1]?.lossClaimable).toBe(0n);
});
