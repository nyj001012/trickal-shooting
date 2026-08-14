// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fireWeapon } from '@/game/systems/weapon';
import { BALANCE } from '@/game/balance';
import { makePlayer, makeWorld } from '../helpers/fixtures';
import type { Projectile } from '@/contracts';

const DT = BALANCE.loop.FIXED_STEP_MS / 1000;

describe('fireWeapon — input-free automatic fire (INV-FIRE-1, D-2)', () => {
  it('spawns exactly one projectile automatically when the cooldown is ready', () => {
    const world = makeWorld({ player: makePlayer({ x: 100, y: 200, fireCooldownRemainSec: 0 }) });
    fireWeapon(world, DT);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0].x).toBe(100);
    expect(world.projectiles[0].y).toBe(200);
    expect(world.projectiles[0].alive).toBe(true);
    expect(world.projectiles[0].damage).toBe(BALANCE.projectile.damage);
    expect(world.projectiles[0].lifetimeRemainSec).toBe(BALANCE.projectile.lifetimeSec);
    expect(world.player.fireCooldownRemainSec).toBeCloseTo(BALANCE.player.fireCooldownSec, 5);
  });

  it('does not fire while the cooldown remains positive, but still decrements it by dt', () => {
    const world = makeWorld({ player: makePlayer({ fireCooldownRemainSec: 0.2 }) });
    fireWeapon(world, DT);
    expect(world.projectiles).toHaveLength(0);
    expect(world.player.fireCooldownRemainSec).toBeCloseTo(0.2 - DT, 5);
  });

  it('fires again after exactly 0.3 seconds without any input', () => {
    expect(BALANCE.player.fireCooldownSec).toBe(0.3);
    const world = makeWorld({
      player: makePlayer({ fireCooldownRemainSec: 0 }),
    });

    fireWeapon(world, DT);
    expect(world.projectiles).toHaveLength(1);

    const ticksPerCooldown = Math.round(BALANCE.player.fireCooldownSec / DT);
    for (let i = 0; i < ticksPerCooldown - 1; i += 1) {
      fireWeapon(world, DT);
    }
    expect(world.projectiles).toHaveLength(1);

    fireWeapon(world, DT);
    expect(world.projectiles).toHaveLength(2);
    expect(world.player.fireCooldownRemainSec).toBeCloseTo(BALANCE.player.fireCooldownSec, 5);
  });

  it('does not exceed BalanceConfig.limits.maxProjectiles — the spawn is silently skipped, not queued (§6.10)', () => {
    const existing: Projectile[] = Array.from(
      { length: BALANCE.limits.maxProjectiles },
      (_unused, i) => ({
        id: i,
        kind: 'projectile',
        x: 0,
        y: 0,
        width: BALANCE.projectile.width,
        height: BALANCE.projectile.height,
        alive: true,
        damage: BALANCE.projectile.damage,
        lifetimeRemainSec: BALANCE.projectile.lifetimeSec,
      }),
    );
    const world = makeWorld({
      player: makePlayer({ fireCooldownRemainSec: 0 }),
      projectiles: existing,
      nextEntityId: BALANCE.limits.maxProjectiles,
    });
    fireWeapon(world, DT);
    expect(world.projectiles.length).toBe(BALANCE.limits.maxProjectiles);
    expect(world.nextEntityId).toBe(BALANCE.limits.maxProjectiles);
    expect(world.player.fireCooldownRemainSec).toBe(BALANCE.player.fireCooldownSec);
  });
});
