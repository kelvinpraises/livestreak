import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(packageDirectory, "src");

export default defineConfig({
  test: {
    testTimeout: 30_000
  },
  resolve: {
    alias: [
      { find: /^#index\.js$/, replacement: `${sourceDirectory}/index.js` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` },
      { find: /^#pipeline\//, replacement: `${sourceDirectory}/pipeline/` },
      { find: /^#adapters\//, replacement: `${sourceDirectory}/adapters/` },
      { find: /^#run\//, replacement: `${sourceDirectory}/run/` },
      { find: /^#bridge\//, replacement: `${sourceDirectory}/bridge/` },
      { find: /^#scope\//, replacement: `${sourceDirectory}/scope/` },
      { find: /^#market\//, replacement: `${sourceDirectory}/market/` },
      { find: /^#builtins\.js$/, replacement: `${sourceDirectory}/builtins.js` }
    ]
  }
});
