// WASM round-trip test: decode the engine-generated fixture blob through the wasm build
// and require every view to match the host-side engine's expected values exactly.
// Fixture: chains/solana/test-fixtures (regenerate: cargo run -p livestreak-wasm --example gen-fixture -- ../test-fixtures)
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const solanaRoot = join(here, "..");
const fixtures = join(solanaRoot, "test-fixtures");

const { decodeProtocolBlob } = await import(
  new URL(join("..", "..", "..", "dist", "chains", "solana", "engine-wasm.js"), import.meta.url).href
);

const blob = readFileSync(join(fixtures, "protocol-blob.bin"));
const expected = JSON.parse(readFileSync(join(fixtures, "expected.json"), "utf8"));

const view = await decodeProtocolBlob(blob);
const { vaultId, tokenId, now } = expected;

assert.deepEqual(view.listVaultIds(), [vaultId], "listVaultIds");
assert.deepEqual(view.marketVaults(expected.marketId), [vaultId], "marketVaults");
assert.equal(view.vault(vaultId).outcome, expected.vaultOutcome, "vault outcome");
assert.equal(view.pot(vaultId), BigInt(expected.pot), "pot");

const board = view.board(vaultId, 0);
assert.equal(board.pool, BigInt(expected.boardYes.pool), "board pool");
assert.equal(board.sideRate, BigInt(expected.boardYes.sideRate), "board sideRate");
assert.equal(board.g, BigInt(expected.boardYes.g), "board g");
assert.equal(board.lastAdvance, expected.boardYes.lastAdvance, "board lastAdvance");
assert.equal(board.sideShares, BigInt(expected.boardYes.sideShares), "board sideShares");

const bounds = view.boundaries(vaultId, 0);
assert.equal(bounds.length, expected.boundariesYes.length, "boundaries length");
for (let i = 0; i < bounds.length; i++) {
  assert.equal(bounds[i].maxEnd, expected.boundariesYes[i].maxEnd, `boundary[${i}].maxEnd`);
  assert.equal(bounds[i].rate, BigInt(expected.boundariesYes[i].rate), `boundary[${i}].rate`);
}

assert.equal(
  view.pendingShares(vaultId, 0, tokenId, now),
  BigInt(expected.pendingSharesYes),
  "pendingShares",
);
assert.equal(view.claimable(tokenId, vaultId, 0), BigInt(expected.claimableYes), "claimable");
assert.deepEqual(view.accountVaultIds(tokenId), expected.accountVaults, "accountVaultIds");
assert.equal(view.laneCount(tokenId), expected.laneCount, "laneCount");
assert.equal(view.summary().escrowExpected, BigInt(expected.escrowExpected), "escrowExpected");

view.free();
console.log("wasm round-trip: all views exact vs host-side engine ✓");
