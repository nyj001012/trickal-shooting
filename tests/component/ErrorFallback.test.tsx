// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorFallback } from '@/ui/ErrorFallback';

afterEach(cleanup);

describe('ErrorFallback — loop-crash fallback UI (§6.10)', () => {
  it('renders the provided message text to the user at least once', () => {
    render(<ErrorFallback message="문제가 발생했습니다." />);
    // Only presence is contractually required (ErrorFallbackProps has a single
    // `message: string` field, design.md §5.3 rule 2) — how many times the
    // component chooses to echo it (e.g. a visually-hidden live-region duplicate
    // for screen readers) is an implementation detail this test does not pin down.
    expect(screen.getAllByText('문제가 발생했습니다.').length).toBeGreaterThanOrEqual(1);
  });
});
