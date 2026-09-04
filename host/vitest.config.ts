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
      { find: /^#api\//, replacement: `${sourceDirectory}/api/` },
      { find: /^#config\//, replacement: `${sourceDirectory}/config/` },
      { find: /^#services\//, replacement: `${sourceDirectory}/services/` },
      { find: /^#infrastructure\//, replacement: `${sourceDirectory}/infrastructure/` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` }
    ]
  }
});
