import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'out', 'dist', 'renders', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Sample templates are plain browser scripts embedded in HTML; nothing to lint here.
    files: ['templates/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
