import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `release` is what a packaged build leaves behind (milestone 17): a whole application,
  // minified bundles and all, which is nobody's source to lint.
  { ignores: ['node_modules', 'out', 'dist', 'release', 'renders', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The DOM-level component tests run in happy-dom, not in Node.
    files: ['tests/dom/**/*.ts'],
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
