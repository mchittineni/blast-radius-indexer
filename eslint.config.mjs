// @ts-check
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: ['**/dist/**', 'coverage/**', 'node_modules/**'],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Tooling configs live outside the src tsconfig project but still get linted.
        projectService: {
          allowDefaultProject: ['eslint.config.mjs', 'vitest.config.ts', 'scripts/build.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Actions log to the runner via @actions/core; bare console is a smell in src.
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read configuration through @actions/core inputs, not process.env directly.',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],

      // Every match in this codebase is a single non-global capture, where
      // `String#match` reads better and carries no lastIndex statefulness.
      '@typescript-eslint/prefer-regexp-exec': 'off',
    },
  },
  {
    // Tests may log, use loose assertions, and declare helpers inline.
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `vi.mock` factories need inline `typeof import(...)` type arguments.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Build and tooling scripts are plain JS that never ships in the bundle.
    // Type-aware rules need a typed project they are deliberately outside of.
    files: ['scripts/**/*.mjs', 'eslint.config.mjs', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
