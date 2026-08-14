// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hudStore } from '@/game/hudStore';
import { BALANCE } from '@/game/balance';
import type { HudSnapshot } from '@/contracts';

const initialSnapshot: HudSnapshot = {
  hp: BALANCE.player.maxHp,
  maxHp: BALANCE.player.maxHp,
  mana: 0,
  score: 0,
  level: 1,
  status: 'playing',
};

beforeEach(() => {
  hudStore.reset();
});

describe('hudStore — publish/subscribe (design.md §6.1)', () => {
  it('reset() restores the initial snapshot matching a freshly-created GameWorld.session', () => {
    expect(hudStore.getSnapshot()).toEqual(initialSnapshot);
  });

  it('getSnapshot() returns the same object reference until the next accepted publish (required by useSyncExternalStore)', () => {
    const first = hudStore.getSnapshot();
    const second = hudStore.getSnapshot();
    expect(first).toBe(second);
  });

  it('publish() with a value shallow-equal to the current snapshot does not replace the reference or notify subscribers', () => {
    const before = hudStore.getSnapshot();
    const listener = vi.fn();
    hudStore.subscribe(listener);
    hudStore.publish({ ...before });
    expect(hudStore.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('publish() with at least one changed field replaces the reference and notifies subscribers', () => {
    const listener = vi.fn();
    hudStore.subscribe(listener);
    const next: HudSnapshot = { ...initialSnapshot, score: 10 };
    hudStore.publish(next);
    expect(hudStore.getSnapshot()).toEqual(next);
    expect(hudStore.getSnapshot()).not.toBe(initialSnapshot);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset() notifies subscribers unconditionally, even if the snapshot value does not change', () => {
    const listener = vi.fn();
    hudStore.subscribe(listener);
    hudStore.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe() returns an unsubscribe function that stops further notifications', () => {
    const listener = vi.fn();
    const unsubscribe = hudStore.subscribe(listener);
    unsubscribe();
    hudStore.publish({ ...initialSnapshot, score: 99 });
    expect(listener).not.toHaveBeenCalled();
  });
});
