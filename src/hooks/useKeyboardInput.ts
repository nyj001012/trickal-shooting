/**
 * DOM keydown/keyup/blur -> semantic `InputState` ref (design.md §6.2.1-(1)). Raw DOM key
 * codes never leave this hook; `src/game/**` only ever sees the boolean `InputState`
 * shape (§6.0 rule 1). The returned ref is mutated in place by the listeners so the game
 * loop can read the latest value every tick without triggering React re-renders.
 * @module @/hooks/useKeyboardInput
 */
import { useEffect, useRef } from 'react';

import type { InputState } from '@/contracts';

import { createInputState } from '@/game/input';

const CODE_TO_FIELD: Readonly<Record<string, keyof InputState>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'fire',
  KeyR: 'restart',
};

function isTrackedCode(code: string): code is keyof typeof CODE_TO_FIELD {
  return code in CODE_TO_FIELD;
}

export function useKeyboardInput(): Readonly<{ current: Readonly<InputState> }> {
  const inputRef = useRef<InputState>(createInputState());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTrackedCode(event.code)) return;
      event.preventDefault();
      inputRef.current[CODE_TO_FIELD[event.code]] = true;
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!isTrackedCode(event.code)) return;
      event.preventDefault();
      inputRef.current[CODE_TO_FIELD[event.code]] = false;
    };
    const handleBlur = (): void => {
      inputRef.current = createInputState();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return inputRef;
}
