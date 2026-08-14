/**
 * Fresh, all-false `InputState` factory (design.md §6.2.1-(1) — used on mount and to
 * fully reset input on window `blur`).
 * @module @/game/input
 */
import type { CreateInputState, InputState } from '@/contracts';

export const createInputState: CreateInputState = (): InputState => ({
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  restart: false,
});
