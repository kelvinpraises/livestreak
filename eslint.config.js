import eslint from '@eslint/js';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.output/**',
      '**/.tanstack/**',
      '**/out/**',
      'packages/contracts/chains/evm/lib/**',
      'packages/contracts/chains/evm/out/**',
      'packages/contracts/chains/evm/cache/**',
      'packages/contracts/chains/evm/generated/**',
      'packages/wallet/src/vendor/**',
      '**/routeTree.gen.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);
