// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fireWeapon } from '@/game/systems/weapon';
import { BALANCE } from '@/game/balance';
import { makeInputState, makePlayer, makeWorld } from '../helpers/fixtures';
import type { Projectile } from '@/contracts';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('fireWeapon — cooldown gating (INV-FIRE-1, D-2)', () => {
  it('spawns exactly one projectile at the player position when fire is pressed and cooldown is ready', () => {
    const world = makeWorld({ player: makePlayer({ x: 100, y: 200, fireCooldownRemainSec: 0 }) });
    fireWeapon(world, makeInputState({ fire: true }), DT);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0].x).toBe(100);
    expect(world.projectiles[0].y).toBe(200);
    expect(world.projectiles[0].alive).toBe(true);
    expect(world.projectiles[0].damage).toBe(BALANCE.projectile.damage);
    expect(world.projectiles[0].lifetimeRemainSec).toBe(BALANCE.projectile.lifetimeSec);
    expect(world.player.fireCooldownRemainSec).toBeCloseTo(BALANCE.player.fireCooldownSec, 5);
  });

  it('does not fire when fire is not pressed, but still decrements the cooldown by dt', () => {
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: 0.2 }) });
    fireWeapon(world, makeInputState({ fire: false }), DT);
    expect(world.projectiles).toHaveLength(0);
    expect(world.player.fireCooldownRemainSec).toBeCloseTo(0.2 - DT, 5);
  });

  it('produces zero new projectiles across many ticks while the cooldown stays positive, even if fire is held every tick (no input buffering/queueing)', () => {
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: BALANCE.player.fireCooldownSec }) });
    // Stop well short of the cooldown reaching zero, so it is guaranteed to still
    // be positive on every iteration of this loop.
    const halfCooldownTicks = Math.max(1, Math.floor(BALANCE.player.fireCooldownSec / DT / 2));
    for (let i = 0; i < halfCooldownTicks; i += 1) {
      fireWeapon(world, makeInputState({ fire: true }), DT);
    }
    expect(world.projectiles).toHaveLength(0);
  });

  it('never lets the cooldown go negative', () => {
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: DT / 2 }) });
    fireWeapon(world, makeInputState({ fire: false }), DT);
    expect(world.player.fireCooldownRemainSec).toBe(0);
  });

  it('fires again once the cooldown has fully elapsed, resuming normal fire-on-ready behavior', () => {
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: DT }) });
    fireWeapon(world, makeInputState({ fire: true }), DT); // cooldown hits 0 this tick -> fires
    expect(world.projectiles).toHaveLength(1);
  });

  it('does not exceed BalanceConfig.limits.maxProjectiles — the spawn is silently skipped, not queued (§6.10)', () => {
    const existing: Projectile[] = Array.from({ length: BALANCE.limits.maxProjectiles }, (_unused, i) => ({
      id: i,
      kind: 'projectile',
      x: 0,
      y: 0,
      width: BALANCE.projectile.width,
      height: BALANCE.projectile.height,
      alive: true,
      damage: BALANCE.projectile.damage,
      lifetimeRemainSec: BALANCE.projectile.lifetimeSec,
    }));
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: 0 }), projectiles: existing });
    fireWeapon(world, makeInputState({ fire: true }), DT);
    expect(world.projectiles.length).toBe(BALANCE.limits.maxProjectiles);
  });
});
