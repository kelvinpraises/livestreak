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
      { find: /^#server\//, replacement: `${sourceDirectory}/server/` },
      { find: /^#descriptor\//, replacement: `${sourceDirectory}/descriptor/` },
      { find: /^#policy\//, replacement: `${sourceDirectory}/policy/` },
      { find: /^#sessions\//, replacement: `${sourceDirectory}/sessions/` },
      { find: /^#manifests\//, replacement: `${sourceDirectory}/manifests/` },
      { find: /^#cache\//, replacement: `${sourceDirectory}/cache/` },
      { find: /^#similarity\//, replacement: `${sourceDirectory}/similarity/` },
      { find: /^#forum\//, replacement: `${sourceDirectory}/forum/` },
      { find: /^#aa\//, replacement: `${sourceDirectory}/aa/` },
      { find: /^#webrtc\//, replacement: `${sourceDirectory}/webrtc/` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` }
    ]
  }
});
