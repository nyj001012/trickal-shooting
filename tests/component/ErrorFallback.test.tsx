// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorFallback } from '@/ui/ErrorFallback';

describe('ErrorFallback — loop-crash fallback UI (§6.10)', () => {
  it('renders the provided message text', () => {
    render(<ErrorFallback message="문제가 발생했습니다." />);
    expect(screen.getByText('문제가 발생했습니다.')).toBeInTheDocument();
  });
});
