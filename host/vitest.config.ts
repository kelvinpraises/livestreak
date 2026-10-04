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
      { find: /^#features\//, replacement: `${sourceDirectory}/features/` },
      { find: /^#http\//, replacement: `${sourceDirectory}/http/` },
      { find: /^#database\//, replacement: `${sourceDirectory}/database/` },
      { find: /^#storage\//, replacement: `${sourceDirectory}/storage/` },
      { find: /^#server\.js$/, replacement: `${sourceDirectory}/server.ts` },
      { find: /^#deps\.js$/, replacement: `${sourceDirectory}/deps.ts` },
      { find: /^#config\//, replacement: `${sourceDirectory}/config/` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` }
    ]
  }
});
