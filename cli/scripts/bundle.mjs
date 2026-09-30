// Workspace-only bundler for the installable CLI artifact. `esbuild` is a declared
// devDependency of the CLI (pinned); the import below resolves in the workspace.
// Bundles every `@livestreak/*` workspace import into dist; published deps stay
// external so the clean consumer installs them from the registry.
// One stub: `@noble/hashes` v1 `cryptoNode.js` is CJS doing require("node:crypto"),
// which esbuild cannot emit into ESM output — redirect it to the ESM shim.
// ponytail: exact-path stub for one CJS file; revisit if noble v1 finally drops out.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const shim = resolve(root, "../shims/noble-cryptonode.mjs");

const nobleCryptoNode = {
  name: "noble-cryptonode-esm",
  setup(b) {
    // utils.js requires the bare subpath `@noble/hashes/crypto`, which the exports
    // map points at the CJS cryptoNode.js (require("node:crypto")) under node.
    b.onResolve({ filter: /@noble\/hashes\/crypto(\.js)?$/ }, () => ({ path: shim }));
  }
};

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  allowOverwrite: true,
  mainFields: ["module", "main"],
  external: [
    "@effect/cli",
    "@effect/platform-node",
    "effect",
    "viem",
    "ws",
    "sodium-universal",
    "sodium-native"
  ],
  plugins: [nobleCryptoNode],
  logLevel: "warning"
};

await build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.js" });
// The agent entry shares the plugins (notably the noble ESM shim): a clean
// consumer imports it directly, so it must load exactly like the main bundle.
await build({ ...shared, entryPoints: ["src/agent-client.ts"], outfile: "dist/agent-client.js" });
