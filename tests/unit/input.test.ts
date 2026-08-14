// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInputState } from '@/game/input';

describe('createInputState', () => {
  it('returns a fresh InputState with every flag false', () => {
    expect(createInputState()).toEqual({
      up: false,
      down: false,
      left: false,
      right: false,
      restart: false,
    });
  });

  it('returns a new object on every call (not a shared singleton) — needed so blur-reset never aliases a previous frame', () => {
    expect(createInputState()).not.toBe(createInputState());
  });
});
