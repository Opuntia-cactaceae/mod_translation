import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { RuntimeLog } from '../TracePanel';
import type { RuntimeRawLogLine } from '../../../api/types';

afterEach(() => cleanup());

describe('RuntimeLog', () => {
  it('shows "No live runtime events yet" when lines is empty', () => {
    render(React.createElement(RuntimeLog, { lines: [] }));
    expect(screen.getByText('No live runtime events yet.')).toBeTruthy();
  });

  it('renders raw log lines as they are', () => {
    const lines: RuntimeRawLogLine[] = [
      { ts: '2025-01-01T12:00:00Z', level: 'INFO', message: 'HTTP Request: POST https://api.groq.com/openai/v1/chat/completions "HTTP/1.1 200 OK"' },
      { ts: '2025-01-01T12:00:01Z', level: 'WARNING', message: 'Retrying request to /openai/v1/chat/completions in 2.000000 seconds' },
      { ts: '2025-01-01T12:00:02Z', level: 'ERROR', message: 'HTTP Request: POST https://api.groq.com/openai/v1/chat/completions "HTTP/1.1 429 Too Many Requests"' },
    ];

    const { container } = render(React.createElement(RuntimeLog, { lines }));

    // All messages should be present in rendered output
    expect(container.textContent).toContain('HTTP Request: POST https://api.groq.com/openai/v1/chat/completions "HTTP/1.1 200 OK"');
    expect(container.textContent).toContain('Retrying request to /openai/v1/chat/completions in 2.000000 seconds');
    expect(container.textContent).toContain('HTTP Request: POST https://api.groq.com/openai/v1/chat/completions "HTTP/1.1 429 Too Many Requests"');
  });

  it('preserves raw text without domain classification', () => {
    const lines: RuntimeRawLogLine[] = [
      { ts: '2025-01-01T12:00:00Z', level: 'INFO', message: 'HTTP Request: POST https://api.groq.com/openai/v1/chat/completions "HTTP/1.1 200 OK"' },
    ];

    const { container } = render(React.createElement(RuntimeLog, { lines }));

    // Should contain the raw message, not a classified/summarized version
    const text = container.textContent || '';
    expect(text).toContain('HTTP Request: POST');
    expect(text).toContain('api.groq.com');
    expect(text).toContain('200 OK');
    // Should NOT contain any trace event classification labels
    expect(text).not.toContain('API request');
    expect(text).not.toContain('API response');
    expect(text).not.toContain('Rate Limited');
  });

  it('displays timestamps for each line', () => {
    const lines: RuntimeRawLogLine[] = [
      { ts: '2025-01-01T12:34:56Z', level: 'INFO', message: 'test message' },
    ];

    const { container } = render(React.createElement(RuntimeLog, { lines }));

    // Should contain a time string (locale-dependent format, so just check for minutes:seconds presence)
    expect(container.textContent).toMatch(/:34:56/);
  });

  it('shows at most 200 lines', () => {
    const lines: RuntimeRawLogLine[] = Array.from({ length: 250 }, (_, i) => ({
      ts: '2025-01-01T12:00:00Z',
      level: 'INFO',
      message: `line ${i}`,
    }));

    const { container } = render(React.createElement(RuntimeLog, { lines }));

    // Should contain line 49 (one of the last 200) but not line 0 (outside last 200)
    expect(container.textContent).toContain('line 199');
    expect(container.textContent).toContain('line 249');
    // The old lines (0-49) should not be visible since we only show last 200
    expect(container.textContent).not.toContain('line 0');
    expect(container.textContent).not.toContain('line 49');
  });
});
