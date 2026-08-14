/**
 * World/session/input contracts (SSOT).
 * Declarations only — see the header rules in `entities.ts`.
 */

import type { Enemy, Player, Projectile } from './entities';

/** Fixed logical playfield size (design.md §1.1 — 800x600, never resized). */
export interface Bounds {
  /** px */
  readonly width: number;
  /** px */
  readonly height: number;
}

/**
 * `'error'` is entered when a loop callback throws (design.md §6.10) — the loop stops
 * and the last rendered frame is kept; it is not a normal gameplay state transition.
 */
export type GameStatus = 'playing' | 'gameover' | 'error';

/** The scalar, HUD-facing part of game state. Single source of truth for HP/MANA/SCORE/LEVEL. */
export interface GameSession {
  /** count; current player HP. GameOver is entered the tick this reaches <= 0 (D-6). */
  hp: number;
  /** count; HP ceiling, fixed for the lifetime of one GameWorld. */
  readonly maxHp: number;
  /** percent, 0-100. Resets to 0 on reaching >= 100 (D-3). Never negative, never > 100. */
  mana: number;
  /** count; monotonically non-decreasing within one GameWorld lifetime. */
  score: number;
  /** integer >= 1. Increases via score thresholds (D-4). */
  level: number;
  status: GameStatus;
}

/** Enemy-spawn timing state. */
export interface SpawnerState {
  /** sec; counts down to 0, then an enemy spawns and this resets to currentIntervalSec. */
  intervalRemainSec: number;
  /**
   * sec; current interval between spawns. Starts at BalanceConfig.spawn.initialIntervalSec
   * and shrinks by BalanceConfig.spawn.intervalDecayPerLevel on each level-up, floored at
   * BalanceConfig.spawn.minIntervalSec (D-4, §6.2.1-(5)).
   */
  currentIntervalSec: number;
}

/**
 * Semantic, DOM-independent input snapshot. Produced by hooks/useKeyboardInput.ts from
 * `event.code`; `src/game/**` never sees raw DOM key codes (§6.0 rule 1, §6.2.1-(1)).
 */
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** true while the fire key is held down (auto-repeats subject to cooldown, D-2). */
  fire: boolean;
  /** true on the tick the restart key is pressed; only acted on while status === 'gameover'. */
  restart: boolean;
}

/**
 * A deterministic pseudo-random source. Calling it advances internal state and returns a
 * float in [0, 1), identically to `Math.random()`'s contract but reproducible for a given
 * seed + call sequence (design.md §6.2 — "rng는 game/rng.ts의 시드 기반 결정적 생성기").
 * `src/game/**` never calls `Math.random()` directly; every entry point that needs
 * randomness receives an `Rng` as an explicit argument.
 */
export type Rng = () => number;

/**
 * The entire in-memory simulation state for one play session. Held in a single
 * `useRef<GameWorld>` by the React layer and mutated in place by `stepWorld` (§6.1).
 * Never serialized; no persistence of any kind (design.md §1.3).
 */
export interface GameWorld {
  /** Fixed for the lifetime of this GameWorld; the same object every tick. */
  readonly bounds: Bounds;
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  session: GameSession;
  spawner: SpawnerState;
  /** Next value to assign as an entity's `id`, then incremented. Starts at 0. */
  nextEntityId: number;
}
