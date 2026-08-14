// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameCanvas } from '@/ui/GameCanvas';

describe('GameCanvas — canvas element, testid, and accessible label (ui-contracts.md §1, §5)', () => {
  it('renders a <canvas> element with the game-canvas testid and the given aria-label', () => {
    render(<GameCanvas widthPx={800} heightPx={600} ariaLabel="슈팅 게임 화면" />);
    const canvas = screen.getByTestId('game-canvas');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('aria-label', '슈팅 게임 화면');
  });
});
