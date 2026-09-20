// Copies the committed wasm artifacts into dist so compiled imports resolve
// (same pattern as @livestreak/wallet's copy-vendored.mjs).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const src = join(pkgRoot, "chains", "solana", "wasm");
const dest = join(pkgRoot, "dist", "chains", "solana", "wasm");

if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}
