import root from "../../eslint.config.js";

const facadeFiles = [
  "src/index.ts",
  "src/create-wallet-manager.ts",
  "src/types.ts",
];

const vendorImportBlocks = ["**/vendor/**", "#vendor/**"];

export default [
  ...root,
  {
    ignores: ["src/vendor/**", "dist/**"],
  },
  {
    files: ["src/chains/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message:
                "Use #vendor/* imports from chain seams instead of parent-relative paths.",
            },
          ],
        },
      ],
    },
  },
  {
    files: facadeFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: vendorImportBlocks,
              message:
                "Import vendor only via #chains/evm.js or #chains/sui/index.js.",
            },
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message:
                "Use #/* imports (e.g. #chains/..., #types.js) instead of parent-relative paths. Same-folder ./ imports are allowed.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx,mjs}"],
    ignores: ["src/chains/**/*.{ts,tsx}", ...facadeFiles, "test/vectors/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message:
                "Use #/* imports instead of parent-relative paths. Same-folder ./ imports are allowed.",
            },
          ],
        },
      ],
    },
  },
];
