/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite + Vitest integration (design.md §2.2.1 / §6.8).
// - `@/*` alias MUST mirror tsconfig.json's `paths` exactly, or dev works while tests break.
// - Ports are fixed: dev=5173, preview=4173 (design.md §4).
// - Default test environment is `node` (fast, no DOM) for `src/game/**` purity (§6.0 rule 4);
//   `tests/component/**` opts into `jsdom` per-file via a `// @vitest-environment jsdom`
//   pragma (design.md §6.8) — every file under `tests/component/**` must carry it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/game/**', 'src/hooks/**', 'src/ui/**'],
    },
  },
});
