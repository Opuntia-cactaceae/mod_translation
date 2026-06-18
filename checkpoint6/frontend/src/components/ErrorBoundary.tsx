import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback title. */
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in its subtree and displays a readable message
 * instead of a blank page / white screen.
 *
 * In dev mode the error stack is shown for debugging; in production a
 * user-friendly message is displayed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const error = this.state.error;
    const isDev = import.meta.env.DEV;
    const title = this.props.title ?? 'Something went wrong';

    return (
      <div
        style={{
          padding: '2rem',
          maxWidth: 640,
          margin: '2rem auto',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            padding: '1.5rem',
            borderRadius: 'var(--radius)',
            backgroundColor: '#fff3f3',
            border: '1px solid #f5c6cb',
            color: '#721c24',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem' }}>{title}</h2>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
            An unexpected error occurred while rendering this page.
            Try refreshing, or go back to the{' '}
            <a
              href="/"
              style={{ color: '#721c24' }}
              onClick={(e) => {
                e.preventDefault();
                window.location.href = '/';
              }}
            >
              Dashboard
            </a>
            .
          </p>

          {isDev && error && (
            <details style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Error details (dev only)
              </summary>
              <pre
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  backgroundColor: '#fefefe',
                  border: '1px solid #e0e0e0',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: '0.75rem',
                }}
              >
                {error.name}: {error.message}
                {'\n\n'}
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
