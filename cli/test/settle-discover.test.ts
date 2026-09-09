import { describe, expect, it } from "vitest";
import { discoverTokenForVault } from "../src/commands/settle.js";
import type { OptionsEdge } from "../src/adapters/options.js";

const VAULT = `0x${"ab".repeat(32)}`;
const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

// Minimal OptionsEdge stub: discovery only touches readBoard().panel.nfts.
const edgeWithNfts = (nfts: unknown): OptionsEdge =>
  ({ readBoard: async () => ({ panel: { nfts } }) }) as unknown as OptionsEdge;

describe("settle token discovery (S7)", () => {
  it("finds the caller's position NFT for the vault when --token is omitted", async () => {
    const edge = edgeWithNfts([
      { tokenId: "7", owner: OWNER, lanes: [{ vaultId: VAULT.toUpperCase(), side: "yes" }] }
    ]);
    expect(await discoverTokenForVault(edge, VAULT, OWNER)).toBe("7");
  });

  it("ignores NFTs owned by someone else", async () => {
    const edge = edgeWithNfts([
      { tokenId: "9", owner: OTHER, lanes: [{ vaultId: VAULT, side: "yes" }] }
    ]);
    await expect(discoverTokenForVault(edge, VAULT, OWNER)).rejects.toThrow(/no position NFT/i);
  });

  it("errors when no NFT has a lane on the vault", async () => {
    const edge = edgeWithNfts([
      { tokenId: "3", owner: OWNER, lanes: [{ vaultId: `0x${"cd".repeat(32)}`, side: "no" }] }
    ]);
    await expect(discoverTokenForVault(edge, VAULT, OWNER)).rejects.toThrow(/no position NFT/i);
  });

  it("asks for --token when multiple NFTs match", async () => {
    const edge = edgeWithNfts([
      { tokenId: "1", owner: OWNER, lanes: [{ vaultId: VAULT, side: "yes" }] },
      { tokenId: "2", owner: OWNER, lanes: [{ vaultId: VAULT, side: "no" }] }
    ]);
    await expect(discoverTokenForVault(edge, VAULT, OWNER)).rejects.toThrow(/multiple position NFTs/i);
  });
});
