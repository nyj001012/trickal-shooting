/**
 * All gameplay tuning constants (design.md §6.6, §6.6.1). This is the single place
 * magic numbers are allowed to live — `src/game/**`, `src/hooks/**`, `src/ui/**` must
 * import values from here rather than inlining numbers.
 *
 * Values are the greybox recommended defaults from
 * `.claude/_workspace/03_contracts/invariants.md` §3. `loop.*` are fixed by design.md
 * §6.1/§6.2 (not tunable). No `TODO(balance)` placeholders — §9 is confirmed spec.
 */
import type { BalanceConfig } from '@/contracts';

export const BALANCE = {
  canvas: {
    /** px */
    width: 800,
    /** px */
    height: 600,
  },
  player: {
    /** px */
    spawnX: 40,
    /** px */
    spawnY: 300,
    /** px */
    width: 32,
    /** px */
    height: 32,
    /** px/sec */
    speed: 240,
    /** count */
    maxHp: 3,
    /** sec */
    fireCooldownSec: 0.35,
    /** sec */
    invulnSec: 1.0,
  },
  projectile: {
    /** px */
    width: 8,
    /** px */
    height: 4,
    /** px/sec */
    speed: 480,
    /** count */
    damage: 1,
    /** sec */
    lifetimeSec: 2.0,
  },
  enemy: {
    /** px */
    width: 28,
    /** px */
    height: 28,
    /** px/sec */
    speed: 120,
    /** count */
    hp: 1,
    /** count */
    scoreValue: 10,
    /** percent */
    manaGain: 5,
    /** count */
    contactDamage: 1,
    /** count */
    escapeDamage: 1,
  },
  spawn: {
    /** sec */
    initialIntervalSec: 1.2,
    /** sec */
    intervalDecayPerLevel: 0.1,
    /** sec */
    minIntervalSec: 0.35,
    /** px */
    marginY: 20,
  },
  progression: {
    /** percent */
    manaMax: 100,
    /** count */
    levelUpScoreStep: 100,
    /** integer or +Infinity */
    maxLevel: Number.POSITIVE_INFINITY,
  },
  limits: {
    /** count */
    maxEnemies: 40,
    /** count */
    maxProjectiles: 60,
  },
  loop: {
    /** ms */
    FIXED_STEP_MS: 1000 / 60,
    /** ms */
    MAX_FRAME_MS: 250,
    /** count */
    MAX_SUBSTEPS: 5,
    /** ms */
    HUD_PUBLISH_INTERVAL_MS: 100,
  },
} as const satisfies BalanceConfig;
