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
      'app/**',
      'packages/**',
      // 'packages-re2/**',
      // 'cli-re2/**',
      'packages/contracts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginUnicorn.configs['flat/all'],
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
