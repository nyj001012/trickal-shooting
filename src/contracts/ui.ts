/**
 * UI-facing contracts: HUD data flow, component props, and the E2E test bridge.
 *
 * Per design.md §5.3 rule 2, React-specific types (e.g. `ReactNode`, `RefObject`) are
 * NOT declared here — components compose those in `src/ui/**`. Only plain data shapes
 * needed by both sides of the React boundary live in this file.
 *
 * Declarations only — see the header rules in `entities.ts`.
 */

import type { GameStatus } from './world';

/**
 * The only shape the React layer ever reads from the simulation. Field names/values
 * are the direct source for the HUD display-string formats fixed in ui-contracts.md.
 */
export interface HudSnapshot {
  /** count; current player HP. */
  readonly hp: number;
  /** count; HP ceiling. */
  readonly maxHp: number;
  /** percent, 0-100. */
  readonly mana: number;
  /** count. */
  readonly score: number;
  /** integer >= 1. */
  readonly level: number;
  readonly status: GameStatus;
}

/**
 * Framework-independent publish/subscribe store bridging the rAF loop and React
 * (design.md §6.1). Must be implementable and unit-testable with `environment: node`
 * (no DOM dependency).
 */
export interface HudStore {
  /** Registers `callback` to run after every accepted `publish`. Returns an unsubscribe function. */
  subscribe(callback: () => void): () => void;
  /**
   * Returns the current snapshot. Must return the *same object reference* across calls
   * until the next accepted `publish`, so `useSyncExternalStore` never tears or loops.
   */
  getSnapshot(): Readonly<HudSnapshot>;
  /**
   * Shallow-compares `next` against the currently stored snapshot; only replaces the
   * stored reference and notifies subscribers when at least one field differs.
   * Callers throttle their own call frequency (design.md §6.1) — this function does not
   * throttle internally, so a `status` transition can always be published immediately.
   * @mutates internal module-level store state
   */
  publish(next: Readonly<HudSnapshot>): void;
  /**
   * Restores the store to its initial snapshot (matching a freshly-created
   * `GameWorld.session`) and notifies subscribers unconditionally. Used on restart (D-6).
   * @mutates internal module-level store state
   */
  reset(): void;
}

/** Props for `src/ui/Hud.tsx`. */
export interface HudProps {
  readonly snapshot: Readonly<HudSnapshot>;
}

/** Props for `src/ui/GameCanvas.tsx`. Logical (CSS) pixel size; DPR scaling is internal. */
export interface GameCanvasProps {
  /** px; logical width, always 800 in this phase (BalanceConfig.canvas.width). */
  readonly widthPx: number;
  /** px; logical height, always 600 in this phase (BalanceConfig.canvas.height). */
  readonly heightPx: number;
  /** Accessible name for the canvas element (design.md §6.10 accessibility). */
  readonly ariaLabel: string;
}

/** Props for `src/ui/ErrorFallback.tsx`, rendered by the Error Boundary in `App.tsx`. */
export interface ErrorFallbackProps {
  /** Human-readable message shown to the player when the loop has crashed. */
  readonly message: string;
}

/**
 * The E2E observation/control surface (design.md §6.9). Exactly these three members —
 * no gameplay-bypassing "cheat" APIs (e.g. directly setting score) are ever added.
 * Exposed at `window.__TRICKAL_TEST__` only when the app is loaded with `?e2e=1`; the
 * global's declaration (optional, since it is `undefined` otherwise) lives in
 * `src/types/global.d.ts` (frontend-developer), which imports this type.
 */
export interface TestBridge {
  /** Returns the same snapshot the HUD is currently displaying. */
  getSnapshot(): Readonly<HudSnapshot>;
  /**
   * Advances the simulation by exactly `frameCount` fixed ticks, bypassing `rAF` and
   * wall-clock time entirely, so E2E assertions never depend on real-time waits.
   * @mutates the underlying GameWorld (via stepWorld), the HudStore
   */
  stepFrames(frameCount: number): void;
  /**
   * Replaces the underlying Rng with a freshly seeded one (see `CreateRng`), for
   * deterministic spawn-order assertions. Does not otherwise alter world state.
   * @mutates the underlying Rng instance held by the loop
   */
  seed(seedValue: number): void;
}
