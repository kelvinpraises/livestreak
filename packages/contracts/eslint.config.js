import root from "../../eslint.config.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...root,
  {
    ignores: [
      "dist/**",
      "chains/evm/lib/**",
      "chains/evm/out/**",
      "chains/evm/cache/**",
      "chains/evm/generated/**",
      "chains/evm/wagmi.config.ts"
    ]
  },
  {
    files: ["kit/**/*.ts", "chains/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./chains/evm/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
];
