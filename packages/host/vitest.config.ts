import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(packageDirectory, "src");

export default defineConfig({
  test: {
    testTimeout: 10_000
  },
  resolve: {
    alias: [
      { find: /^#index\.js$/, replacement: `${sourceDirectory}/index.js` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` }
    ]
  }
});
