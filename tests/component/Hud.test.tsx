// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Hud } from '@/ui/Hud';
import type { HudSnapshot } from '@/contracts';

// vite.config.ts sets `test.globals: false`, so @testing-library/react's automatic
// cleanup (which relies on detecting a global `afterEach`) never registers itself.
// Without this, each `render()` below would leave its DOM tree mounted for the next
// `it()` in this file, causing bogus "multiple elements found" failures.
afterEach(cleanup);

describe('Hud — display-string formats and data-testid (ui-contracts.md §1)', () => {
  const snapshot: HudSnapshot = { hp: 3, maxHp: 3, mana: 0, score: 0, level: 1, status: 'playing' };

  it('renders HP/MANA/SCORE/LEVEL with the fixed formats', () => {
    render(<Hud snapshot={snapshot} />);
    expect(screen.getByTestId('hud-hp')).toHaveTextContent('♥ 3 / 3');
    expect(screen.getByTestId('hud-mana')).toHaveTextContent('MANA: 0%');
    expect(screen.getByTestId('hud-score')).toHaveTextContent('SCORE: 0');
    expect(screen.getByTestId('hud-level')).toHaveTextContent('LV. 1');
  });

  it('reflects updated values on re-render as plain integers (no decimals, no thousands separators)', () => {
    const updated: HudSnapshot = { hp: 42, maxHp: 99, mana: 87, score: 12345, level: 7, status: 'playing' };
    const { rerender } = render(<Hud snapshot={snapshot} />);
    rerender(<Hud snapshot={updated} />);
    expect(screen.getByTestId('hud-hp')).toHaveTextContent('♥ 42 / 99');
    expect(screen.getByTestId('hud-mana')).toHaveTextContent('MANA: 87%');
    expect(screen.getByTestId('hud-score')).toHaveTextContent('SCORE: 12345');
    expect(screen.getByTestId('hud-level')).toHaveTextContent('LV. 7');
  });

  it('renders all 4 HUD testids regardless of game-over status (HUD is always mounted)', () => {
    const gameover: HudSnapshot = { ...snapshot, status: 'gameover', hp: 0 };
    render(<Hud snapshot={gameover} />);
    expect(screen.getByTestId('hud-hp')).toBeInTheDocument();
    expect(screen.getByTestId('hud-mana')).toBeInTheDocument();
    expect(screen.getByTestId('hud-score')).toBeInTheDocument();
    expect(screen.getByTestId('hud-level')).toBeInTheDocument();
  });
});
