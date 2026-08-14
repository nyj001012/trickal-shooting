// ESLint 9 flat config (design.md §4.3, FE-DEV owned). TypeScript source per project rule
// ("설정 파일도 *.config.ts를 사용한다").
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Typed via the ambient declaration in `src/types/eslint-config-prettier.d.ts` (the
// package itself ships no types and has no `@types` counterpart).
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // src/tests/e2e — checked against tsconfig.json (§2.2.1), auto-discovered by
    // projectService (no manual `project` array — design.md §4.3).
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        // Keep one project-service configuration for the whole ESLint process. The
        // parser service is shared across matching config blocks, so switching its
        // default project only for root config files becomes order-dependent once
        // Vitest setup and Playwright config are linted in the same invocation.
        projectService: {
          allowDefaultProject: ['*.config.ts'],
          defaultProject: 'tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // *.config.ts (vite/playwright/eslint) — checked against tsconfig.node.json
    // (§2.2.1). Still auto-discovered via `projectService`, just pointed at the
    // node-flavored project as its single `defaultProject` for this file group
    // instead of a hand-enumerated `project: [...]` array (design.md §4.3).
    files: ['*.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts'],
          defaultProject: 'tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // `eslintConfigPrettier`'s own type is provided by `src/types/eslint-config-prettier.d.ts`
  // and resolves correctly under plain `tsc -p tsconfig.node.json` (verified: 0 errors).
  // However typescript-eslint's `projectService.allowDefaultProject` mechanism (required
  // here — design.md §2.2.1 forbids both a manual `parserOptions.project` array and
  // TS project references, and plain `tsconfig.json`-only auto-discovery cannot find
  // `tsconfig.node.json` for root `*.config.ts` files) type-checks this file using an
  // ad-hoc *inferred* TS project that only honors `tsconfig.node.json`'s compilerOptions,
  // not its `include` list — so this one ambient declaration file is invisible to ESLint's
  // (but not `tsc`'s) view of this specific line. Isolated to this single spread.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- see comment above
  eslintConfigPrettier,
);
