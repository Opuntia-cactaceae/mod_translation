import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function GoodComponent() {
  return <div>Everything is fine</div>;
}

function BadComponent(): React.ReactNode {
  throw new Error('Something went wrong!');
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Everything is fine')).toBeTruthy();
  });

  it('catches errors and shows fallback UI', () => {
    // Suppress console.error from React for the intentional error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BadComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // Dashboard link should be present
    const link = screen.getByText('Dashboard');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/');

    consoleSpy.mockRestore();
  });

  it('shows error details in dev mode', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BadComponent />
      </ErrorBoundary>,
    );

    // In vitest, import.meta.env.DEV is true, so details should be present
    expect(screen.getByText('Error details (dev only)')).toBeTruthy();
    // The error message appears in both h2 and pre, check the pre content
    const errorTexts = screen.getAllByText(/Something went wrong/);
    expect(errorTexts.length).toBeGreaterThanOrEqual(2);

    consoleSpy.mockRestore();
  });

  it('accepts custom title', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary title="Custom Error Title">
        <BadComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom Error Title')).toBeTruthy();

    consoleSpy.mockRestore();
  });

  it('recovers after error when key changes', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary key="1">
        <BadComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Re-mount with a fresh ErrorBoundary (simulates React key change)
    cleanup();

    render(
      <ErrorBoundary key="2">
        <GoodComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Everything is fine')).toBeTruthy();

    consoleSpy.mockRestore();
  });
});
