// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { GameBoard } from '@/ui/GameBoard';
import { BALANCE } from '@/game/balance';

// DOM cleanup between tests is registered globally in vitest.setup.ts (FE-DEV owned,
// `afterEach(() => cleanup())`) to work around `test.globals: false` (vite.config.ts).

beforeEach(() => {
  // Reset the URL between tests so the ?e2e=1-gated test bridge (§6.9) only
  // loads in the test that explicitly opts into it.
  window.history.pushState({}, '', '/');
});

describe('GameBoard — initial render (design.md §6.1, ui-contracts.md §1)', () => {
  it('renders the HUD with the values of a freshly-created world and no game-over overlay', () => {
    render(<GameBoard />);
    expect(screen.getByTestId('hud-hp')).toHaveTextContent(
      `♥ ${BALANCE.player.maxHp} / ${BALANCE.player.maxHp}`,
    );
    expect(screen.getByTestId('hud-mana')).toHaveTextContent('MANA: 0%');
    expect(screen.getByTestId('hud-score')).toHaveTextContent('SCORE: 0');
    expect(screen.getByTestId('hud-level')).toHaveTextContent('LV. 1');
    expect(screen.queryByTestId('game-over')).not.toBeInTheDocument();
    expect(screen.getByTestId('game-canvas')).toBeInTheDocument();
  });
});

describe('GameBoard — keyboard input (ui-contracts.md §2) does not crash the loop', () => {
  it('accepts every bound movement/fire key without throwing and keeps the HUD in a valid textual state', () => {
    render(<GameBoard />);
    const codes = [
      'ArrowRight',
      'KeyD',
      'ArrowUp',
      'KeyW',
      'ArrowLeft',
      'KeyA',
      'ArrowDown',
      'KeyS',
      'Space',
    ];
    for (const code of codes) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      });
    }
    for (const code of codes) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      });
    }
    expect(screen.getByTestId('hud-hp')).toHaveTextContent(/^♥ \d+ \/ \d+$/);
  });
});

describe('GameBoard — game-over overlay (D-6, ui-contracts.md §3) via the E2E test bridge', () => {
  it('shows the fixed "GAME OVER" / "Press R to Restart" text once HP is depleted by passive enemy escapes alone (no player input needed)', async () => {
    window.history.pushState({}, '', '/?e2e=1');
    render(<GameBoard />);

    // The bridge is loaded via a dynamic import gated on ?e2e=1 (§6.9); wait for
    // it to attach before using it, instead of a blind real-time sleep.
    await waitFor(() => {
      expect(window.__TRICKAL_TEST__).toBeDefined();
    });

    // Advance far more fixed ticks than any reasonable balance tuning could need
    // for several enemies to spawn, cross the 800px-wide screen, and escape left
    // — this exercises D-5's passive HP loss with zero keyboard input at all.
    act(() => {
      window.__TRICKAL_TEST__?.stepFrames(20000);
    });

    await waitFor(() => {
      expect(screen.getByTestId('game-over')).toBeInTheDocument();
    });
    expect(screen.getByText('GAME OVER')).toBeInTheDocument();
    expect(screen.getByText(/Press R to Restart/i)).toBeInTheDocument();
    expect(window.__TRICKAL_TEST__?.getSnapshot().status).toBe('gameover');
  }, 10000);
});
