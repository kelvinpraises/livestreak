// ESM replacement for `@noble/hashes` v1 `cryptoNode.js` (workspace root has 1.8.0,
// pulled in via WDK-era CJS deps). The original does `require("node:crypto")` and
// prefers `.webcrypto`, falling back to the node crypto object. esbuild cannot turn
// that CJS+builtin pattern into ESM output, so the bundler resolves here instead.
// Semantics mirror the original: webcrypto first, node crypto fallback.
import nodeCrypto from "node:crypto";

const nc =
  nodeCrypto !== null && typeof nodeCrypto === "object" ? nodeCrypto : undefined;

export const crypto =
  nc !== undefined && "webcrypto" in nc && nc.webcrypto !== undefined
    ? nc.webcrypto
    : nc;
