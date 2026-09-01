import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;
const edgeContractPath = path.join(packageRoot, "test/edge/public-edge-contract.test.ts");
const edgeContractSource = readFileSync(edgeContractPath, "utf8");

const forbiddenImportPatterns = [
  /from\s+["']#run\//,
  /from\s+["']#pipeline\//,
  /from\s+["']#bridge\//,
  /from\s+["']#scope\//,
  /from\s+["']#builtins\//
];

describe("public edge contract architecture guard", () => {
  it("public edge contract test imports observe only from #index.js and allowed helpers", () => {
    for (const pattern of forbiddenImportPatterns) {
      expect(edgeContractSource).not.toMatch(pattern);
    }

    expect(edgeContractSource).toMatch(/from\s+["']#index\.js["']/);
    expect(edgeContractSource).toMatch(/from\s+["']#test\/helpers\//);
    expect(edgeContractSource).toMatch(/from\s+["']@livestreak\/core["']/);
    expect(edgeContractSource).not.toMatch(/cause\.toString\(\)/);
  });
});
