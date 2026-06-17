import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'build',
      'out',
      'coverage',
      'storybook-static',
      'node_modules',
      '.claude/worktrees',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The custom test runner and each suite report results via console.log
    // (see scripts/run-tests.ts) — that's intended output, not stray logging.
    files: ['**/*.test.ts', 'scripts/run-tests.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
