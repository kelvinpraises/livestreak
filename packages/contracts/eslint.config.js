import root from "../../eslint.config.js";

export default [
  ...root,
  {
    ignores: [
      "dist/**",
      "chains/evm/lib/**",
      "chains/evm/out/**",
      "chains/evm/cache/**",
      "chains/evm/generated/**"
    ]
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
];
