/**
 * Global ambient declarations (frontend-developer owned, design.md §6.9).
 *
 * `window.__TRICKAL_TEST__` only exists when the app is bootstrapped with `?e2e=1`
 * (see `src/testBridge.ts`); everywhere else it is `undefined`, hence the `?` — every
 * call site is forced to null-check / optional-chain (`window.__TRICKAL_TEST__?.seed(1)`).
 * This file declares no runtime code, so it has zero bundle-size impact.
 */
import type { TestBridge } from '@/contracts';

declare global {
  interface Window {
    __TRICKAL_TEST__?: TestBridge;
  }
}

export {};
