// Vitest global setup (design.md §6.8, FE-DEV owned).
// - jest-dom matchers for `tests/component/**` assertions on rendered DOM.
// - jsdom does not implement a 2D canvas context, so `getContext('2d')` returns `null`
//   there and any component that calls it would crash. We stub it with an object whose
//   drawing methods are all `vi.fn()` — component tests assert on rendered *text* (HUD,
//   overlays), never on what was drawn to the canvas (§6.8).
//
// Implementation note: the override is installed via `Object.defineProperty` rather
// than a direct `HTMLCanvasElement.prototype.getContext = ...` assignment. The real DOM
// lib type for `getContext` is a large overloaded signature that a lightweight stub
// object can never structurally satisfy, which would otherwise force an `as unknown as`
// cast (banned outright, design.md §6.5.3) or `any` (requires orchestrator sign-off,
// §6.5.2). `PropertyDescriptor.value` is untyped by the DOM lib itself, so assigning our
// own concretely-typed stub into it needs no cast or `any` on our side at all — the
// escape hatch already exists in `lib.es5.d.ts`, we're just using it.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// `test.globals: false` (vite.config.ts) means @testing-library/react's own
// auto-cleanup-detection (which piggybacks on a global `afterEach`) never registers
// itself, so every `tests/component/**` file would otherwise need its own
// `afterEach(cleanup)` boilerplate to avoid DOM accumulating across `render()` calls in
// the same file. Registered once, globally, here instead (design.md §6.8 — FE-DEV owns
// `vitest.setup.ts`). Harmless as a no-op for `tests/unit/**` (`environment: node`),
// since `cleanup()` only iterates whatever containers were actually mounted.
afterEach(() => {
  cleanup();
});

declare global {
  // `declare global` variable augmentation requires `var` — TypeScript rejects
  // `let`/`const` here regardless of lint config, so no eslint-disable is needed.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// React 19 + Testing Library under Vitest needs this flag to know it's running inside
// an `act()`-aware test environment, otherwise state updates triggered by user-event /
// fireEvent log spurious "not configured to support act(...)" warnings.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Minimal stand-in for CanvasRenderingContext2D. Only the methods this project's
 * `src/render/**` actually calls need to exist; add more here if a new drawing call is
 * introduced and a component test starts crashing under jsdom.
 */
function createStubCanvasRenderingContext2D() {
  return {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
  };
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: (contextId: string) =>
      contextId === '2d' ? createStubCanvasRenderingContext2D() : null,
  });
}
