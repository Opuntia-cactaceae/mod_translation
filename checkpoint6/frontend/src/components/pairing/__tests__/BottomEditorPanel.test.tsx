/* ------------------------------------------------------------------ */
/*  Tests: BottomEditorPanel — singleton bottom editor for Pairing     */
/*  Workspace. Verifies tab switching, pair ID display, close, and     */
/*  pair-change reset.                                                 */
/*                                                                      */
/*  Tabs: File View and Line Editor (Normalize is now embedded in      */
/*  File View as a collapsible section — no separate tab).              */
/*                                                                      */
/*  Both tab panels are always MOUNTED; inactive ones are hidden via    */
/*  the HTML5 `hidden` attribute to preserve internal draft/edit state. */
/*                                                                      */
/*  Also verifies shared preview: one API call per pairId, no re-fetch  */
/*  on tab switch.                                                      */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import BottomEditorPanel from '../BottomEditorPanel';

/* ================================================================== */
/*  Mock api (used by BottomEditorPanel to fetch preview)              */
/* ================================================================== */

const { mockGetPreview } = vi.hoisted(() => ({
  mockGetPreview: vi.fn(),
}));

vi.mock('../../../App', () => {
  function MockApiError(message: string) {
    const err = new Error(message);
    err.name = 'ApiError';
    return err;
  }
  MockApiError.prototype = Object.create(Error.prototype);

  return {
    api: { getPairingPairPreview: mockGetPreview },
    ApiError: MockApiError,
  };
});

/* ================================================================== */
/*  Mock child components — simple stubs to verify props flow          */
/* ================================================================== */

const mockFileViewRenderCount = { current: 0 };
const mockLineEditorRenderCount = { current: 0 };

vi.mock('../PairFileViewPanel', () => ({
  default: vi.fn((props: any) => {
    mockFileViewRenderCount.current++;
    return (
      <div data-testid="pair-file-view-panel">
        PairFileViewPanel
        {props.pairId && <span data-testid="pv-pair-id">{props.pairId}</span>}
        {props.projectId && <span data-testid="pv-project-id">{props.projectId}</span>}
        {props.loading && <span data-testid="pv-loading">loading</span>}
        {props.error && <span data-testid="pv-error">{props.error}</span>}
        {props.preview && <span data-testid="pv-has-preview">has-preview</span>}
        {props.normalizeAutoExpandKey != null && (
          <span data-testid="pv-norm-key">{props.normalizeAutoExpandKey}</span>
        )}
        <textarea
          data-testid="pv-textarea"
          onChange={() => props.onDirtyChange?.(true)}
        />
        <button
          data-testid="mock-content-saved"
          onClick={() => props.onContentSaved?.()}
        >
          Content Saved (mock)
        </button>
      </div>
    );
  }),
}));

vi.mock('../PairLineEditorPanel', () => ({
  default: vi.fn((props: any) => {
    mockLineEditorRenderCount.current++;
    return (
      <div data-testid="pair-line-editor-panel">
        PairLineEditorPanel
        {props.pairId && <span data-testid="le-pair-id">{props.pairId}</span>}
        {props.projectId && <span data-testid="le-project-id">{props.projectId}</span>}
        {props.loading && <span data-testid="le-loading">loading</span>}
        {props.error && <span data-testid="le-error">{props.error}</span>}
        {props.preview && <span data-testid="le-has-preview">has-preview</span>}
        <textarea
          data-testid="le-textarea"
          onChange={() => props.onDirtyChange?.(true)}
        />
        <button
          data-testid="le-content-saved"
          onClick={() => props.onContentSaved?.()}
        >
          Content Saved (mock)
        </button>
        <button
          data-testid="mock-open-in-file-view"
          onClick={() =>
            props.onOpenInFileView?.({
              sourceLineNumber: 3,
              translatedLineNumber: 5,
            })
          }
        >
          Open in File View (mock)
        </button>
      </div>
    );
  }),
}));

/* ================================================================== */
/*  Test data                                                          */
/* ================================================================== */

const MOCK_PREVIEW = {
  pair: { id: 'pair-abc123def', project_id: 'proj-1', status: 'manual', confidence: 1 } as any,
  source_file: { file_id: 'f1', relative_path: 'src/source.txt', content: 'src', encoding: 'utf-8', line_count: 1, size_bytes: 3 },
  translated_file: { file_id: 'f2', relative_path: 'src/trans.txt', content: 'trans', encoding: 'utf-8', line_count: 1, size_bytes: 5 },
};

/* ================================================================== */
/*  Re-import mocks for assertions                                     */
/* ================================================================== */

import PairFileViewPanel from '../PairFileViewPanel';
import PairLineEditorPanel from '../PairLineEditorPanel';

/* ================================================================== */
/*  Helpers                                                             */
/* ================================================================== */

/** Get the `.pw-bottom-editor__tab-panel` wrapper for a test-id element. */
function getTabPanel(testId: string): HTMLElement | null {
  const el = screen.queryByTestId(testId);
  if (!el) return null;
  return el.closest('.pw-bottom-editor__tab-panel');
}

function expectHidden(testId: string) {
  const panel = getTabPanel(testId);
  expect(panel).not.toBeNull();
  expect(panel!.hidden).toBe(true);
}

function expectVisible(testId: string) {
  const panel = getTabPanel(testId);
  expect(panel).not.toBeNull();
  expect(panel!.hidden).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPreview.mockReset();
  mockGetPreview.mockResolvedValue(MOCK_PREVIEW); // default: succeed silently
  mockFileViewRenderCount.current = 0;
  mockLineEditorRenderCount.current = 0;
});

afterEach(cleanup);

function renderPanel(overrides: Record<string, any> = {}) {
  const handlers = {
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(
    <BottomEditorPanel
      projectId="proj-1"
      pairId="pair-abc123def"
      onClose={handlers.onClose}
    />,
  );
  return { view, handlers };
}

function renderPanelWithProps(props: Record<string, any> = {}) {
  const handlers = {
    onClose: vi.fn(),
  };
  const view = render(
    <BottomEditorPanel
      projectId={props.projectId ?? 'proj-1'}
      pairId={props.pairId ?? 'pair-abc123def'}
      initialTab={props.initialTab}
      onClose={handlers.onClose}
      {...props}
    />,
  );
  return { view, handlers };
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('BottomEditorPanel', () => {
  describe('toolbar rendering', () => {
    it('renders File View and Line Editor tab buttons (no separate Normalize tab)', () => {
      renderPanel();

      expect(screen.getByText('File View')).toBeTruthy();
      expect(screen.getByText('Line Editor')).toBeTruthy();
      expect(screen.queryByText('Normalize')).toBeNull();
    });

    it('renders Close button', () => {
      renderPanel();

      expect(screen.getByText('Close')).toBeTruthy();
    });

    it('displays truncated pair ID (first 8 chars)', () => {
      renderPanel();

      const span = screen.getByTitle('pair-abc123def');
      expect(span.textContent).toContain('pair-abc');
      expect(span.textContent).toContain('Pair:');
    });

    it('shows the full pair ID as title attribute on the span', () => {
      renderPanel();

      const span = screen.getByTitle('pair-abc123def');
      expect(span).toBeTruthy();
      expect(span.getAttribute('title')).toBe('pair-abc123def');
    });
  });

  describe('tab behavior — persistent mount', () => {
    it('shows PairFileViewPanel by default (file view tab active)', () => {
      renderPanel();

      expectVisible('pair-file-view-panel');
    });

    it('shows PairFileViewPanel when initialTab is lineEditor (File View still mounted)', () => {
      render(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-abc123def"
          initialTab="lineEditor"
          onClose={vi.fn()}
        />,
      );

      expectVisible('pair-line-editor-panel');
      // File View is mounted but hidden
      expectHidden('pair-file-view-panel');
    });

    it('switches visible panel when Line Editor tab is clicked', () => {
      renderPanel();

      // Initially File View is visible
      expectVisible('pair-file-view-panel');

      fireEvent.click(screen.getByText('Line Editor'));

      // After click, Line Editor becomes visible, File View becomes hidden
      expectVisible('pair-line-editor-panel');
      expectHidden('pair-file-view-panel');
    });

    it('switches back to File View when File View tab is clicked', () => {
      renderPanel();

      // Switch to Line Editor first
      fireEvent.click(screen.getByText('Line Editor'));
      expectVisible('pair-line-editor-panel');
      expectHidden('pair-file-view-panel');

      // Switch back to File View
      fireEvent.click(screen.getByText('File View'));
      expectVisible('pair-file-view-panel');
      expectHidden('pair-line-editor-panel');
    });

    it('applies active CSS class to the active tab only', () => {
      renderPanel();

      const previewTab = screen.getByText('File View');
      const lineEditorTab = screen.getByText('Line Editor');

      // File View is active by default
      expect(previewTab.classList.contains('pw-bottom-editor__tab--active')).toBe(true);
      expect(lineEditorTab.classList.contains('pw-bottom-editor__tab--active')).toBe(false);

      // Click Line Editor
      fireEvent.click(lineEditorTab);
      expect(previewTab.classList.contains('pw-bottom-editor__tab--active')).toBe(false);
      expect(lineEditorTab.classList.contains('pw-bottom-editor__tab--active')).toBe(true);
    });

    it('both tab panels are always mounted; hidden when inactive', () => {
      renderPanel();

      expect(screen.getByTestId('pair-file-view-panel')).toBeTruthy();
      expect(screen.getByTestId('pair-line-editor-panel')).toBeTruthy();

      // File View: not hidden (active tab)
      expect(getTabPanel('pair-file-view-panel')!.hidden).toBe(false);
      // Line Editor: hidden (inactive tab, always mounted)
      expect(getTabPanel('pair-line-editor-panel')!.hidden).toBe(true);
    });

    it('panels stay mounted when switching tabs', () => {
      renderPanel();

      // Switch to Line Editor — File View should stay mounted
      fireEvent.click(screen.getByText('Line Editor'));
      expect(screen.getByTestId('pair-file-view-panel')).toBeTruthy();
      expect(screen.getByTestId('pair-line-editor-panel')).toBeTruthy();
    });
  });

  describe('close action', () => {
    it('calls onClose when Close button is clicked', () => {
      const { handlers } = renderPanel();

      fireEvent.click(screen.getByText('Close'));
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('pair change reset', () => {
    it('resets to initialTab when pairId changes', () => {
      const { view, handlers } = renderPanelWithProps({ pairId: 'pair-old' });

      // Switch to Line Editor
      fireEvent.click(screen.getByText('Line Editor'));
      expectVisible('pair-line-editor-panel');
      expectHidden('pair-file-view-panel');

      // Re-render with new pairId — should reset to default initialTab (file view)
      view.rerender(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-new-xyz"
          onClose={handlers.onClose}
        />,
      );

      // Should be back on File View
      expectVisible('pair-file-view-panel');
      expectHidden('pair-line-editor-panel');
    });

    it('displays updated truncated pair ID after pairId change', () => {
      const { view, handlers } = renderPanelWithProps({ pairId: 'pair-old' });

      view.rerender(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-new-xyz-2"
          onClose={handlers.onClose}
        />,
      );

      const span = screen.getByTitle('pair-new-xyz-2');
      expect(span.textContent).toContain('pair-new');
      expect(span.textContent).toContain('Pair:');
    });
  });

  describe('shared preview — API call behavior', () => {
    it('calls preview API when pairId is provided', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-abc123def');
    });

    it('does NOT re-fetch preview when switching tabs', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      // Wait for API call
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      // Switch to Line Editor — should NOT trigger another API call
      fireEvent.click(screen.getByText('Line Editor'));
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      // Switch back to File View — should NOT trigger another API call
      fireEvent.click(screen.getByText('File View'));
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });
    });

    it('calls preview API again when pairId changes', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      const { view, handlers } = renderPanelWithProps({ pairId: 'pair-first' });

      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      mockGetPreview.mockResolvedValue({ ...MOCK_PREVIEW, pair: { ...MOCK_PREVIEW.pair, id: 'pair-second' } });

      // Change pairId
      view.rerender(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-second"
          onClose={handlers.onClose}
        />,
      );

      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(2);
      });
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-second');
    });

    it('passes preview data to PairFileViewPanel after successful fetch', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId('pv-has-preview')).toBeTruthy();
      });
    });

    it('passes preview data to PairLineEditorPanel after switching tab', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId('pv-has-preview')).toBeTruthy();
      });

      // Switch to Line Editor — should have preview too
      fireEvent.click(screen.getByText('Line Editor'));
      await waitFor(() => {
        expect(screen.getByTestId('le-has-preview')).toBeTruthy();
      });
    });

    it('passes loading state to PairFileViewPanel while fetching', () => {
      // Never resolve so loading stays true
      mockGetPreview.mockReturnValue(new Promise(() => {}));
      renderPanel();

      expect(screen.getByTestId('pv-loading')).toBeTruthy();
    });

    it('passes error state to PairFileViewPanel on failure', async () => {
      mockGetPreview.mockRejectedValue(new Error('API failure'));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId('pv-error')).toBeTruthy();
      });
    });
  });

  describe('stale response guard', () => {
    it('ignores stale preview response when pairId has changed', async () => {
      // Deferred promise for the first request
      let resolveFirst: (v: any) => void;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      // First call: return deferred promise. Subsequent calls: default resolved.
      mockGetPreview.mockReturnValueOnce(firstPromise);

      const { view, handlers } = renderPanelWithProps({ pairId: 'pair-first' });

      // First call should be in flight
      expect(mockGetPreview).toHaveBeenCalledTimes(1);
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-first');

      // Change pairId while first request is still pending
      view.rerender(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-second"
          onClose={handlers.onClose}
        />,
      );

      // Now resolve the stale first request with old pair data
      resolveFirst!({
        ...MOCK_PREVIEW,
        pair: { ...MOCK_PREVIEW.pair, id: 'pair-first' },
      });

      // Wait for all promises to settle
      await new Promise((r) => setTimeout(r, 50));

      // The API was called again for the new pairId (2 total calls)
      expect(mockGetPreview).toHaveBeenCalledTimes(2);
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-second');

      // The rendered pair ID should be pair-second, not the stale pair-first
      const span = screen.getByTitle('pair-second');
      expect(span).toBeTruthy();
    });
  });

  describe('onContentSaved triggers preview re-fetch', () => {
    it('re-fetches preview when onContentSaved is called from child', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      // Trigger onContentSaved from the mocked PairFileViewPanel
      fireEvent.click(screen.getByTestId('mock-content-saved'));

      // Should trigger another preview fetch
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(2);
      });
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-abc123def');
    });

    it('re-fetches preview when Line Editor onContentSaved is called', async () => {
      mockGetPreview.mockResolvedValue(MOCK_PREVIEW);
      renderPanel();

      // Wait for initial fetch
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(1);
      });

      // Trigger onContentSaved from the mocked PairLineEditorPanel
      fireEvent.click(screen.getByTestId('le-content-saved'));

      // Should trigger another preview fetch
      await waitFor(() => {
        expect(mockGetPreview).toHaveBeenCalledTimes(2);
      });
      expect(mockGetPreview).toHaveBeenCalledWith('proj-1', 'pair-abc123def');
    });
  });

  describe('child component wiring', () => {
    it('passes pairId prop to PairFileViewPanel', () => {
      renderPanel();

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(lastCall[0].pairId).toBe('pair-abc123def');
      expect(lastCall[0].preview).toBeNull();
    });

    it('passes projectId prop to PairFileViewPanel', () => {
      renderPanel();

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(lastCall[0].projectId).toBe('proj-1');
    });

    it('passes onContentSaved prop to PairFileViewPanel', () => {
      renderPanel();

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(typeof lastCall[0].onContentSaved).toBe('function');
    });

    it('passes projectId prop to PairLineEditorPanel', () => {
      renderPanel();

      const MockLineEditor = vi.mocked(PairLineEditorPanel);
      const calls = MockLineEditor.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(lastCall[0].projectId).toBe('proj-1');
    });

    it('passes onContentSaved prop to PairLineEditorPanel', () => {
      renderPanel();

      const MockLineEditor = vi.mocked(PairLineEditorPanel);
      const calls = MockLineEditor.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(typeof lastCall[0].onContentSaved).toBe('function');
    });

    it('passes pairId prop to PairLineEditorPanel', () => {
      renderPanel();

      const MockLineEditor = vi.mocked(PairLineEditorPanel);
      const calls = MockLineEditor.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(lastCall[0].pairId).toBe('pair-abc123def');
    });

    it('forwards normalizeAutoExpandKey to PairFileViewPanel', () => {
      render(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-abc123def"
          onClose={vi.fn()}
          normalizeAutoExpandKey={42}
        />,
      );

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0].normalizeAutoExpandKey).toBe(42);
    });

    it('forwards onNormalizationSaved to PairFileViewPanel', () => {
      const onNormSaved = vi.fn();
      render(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-abc123def"
          onClose={vi.fn()}
          onNormalizationSaved={onNormSaved}
        />,
      );

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0].onNormalizationSaved).toBe(onNormSaved);
    });

    it('forwards onNormalizationApplied to PairFileViewPanel', () => {
      const onNormApplied = vi.fn();
      render(
        <BottomEditorPanel
          projectId="proj-1"
          pairId="pair-abc123def"
          onClose={vi.fn()}
          onNormalizationApplied={onNormApplied}
        />,
      );

      const MockFileView = vi.mocked(PairFileViewPanel);
      const calls = MockFileView.mock.calls;
      const lastCall = calls[calls.length - 1];
      // Should be a wrapped function (increments refreshKey + calls original)
      expect(typeof lastCall[0].onNormalizationApplied).toBe('function');
    });
  });

  describe('Line Editor → File View navigation', () => {
    it('switches to File View tab when Open in File View is clicked from Line Editor', () => {
      renderPanel();

      // Initially on File View
      expectVisible('pair-file-view-panel');

      // Switch to Line Editor tab
      fireEvent.click(screen.getByText('Line Editor'));
      expectVisible('pair-line-editor-panel');
      expectHidden('pair-file-view-panel');

      // Click the mock "Open in File View" button inside Line Editor
      fireEvent.click(screen.getByTestId('mock-open-in-file-view'));

      // Should now be back on File View
      expectVisible('pair-file-view-panel');
      expectHidden('pair-line-editor-panel');
    });
  });

  describe('dirty state coordination', () => {
    it('does NOT show Unsaved changes badge initially', () => {
      renderPanel();

      expect(screen.queryByText('Unsaved changes')).toBeNull();
    });

    it('shows Unsaved changes indicator when child reports dirty', async () => {
      renderPanel();

      await waitFor(() => {
        expect(screen.queryByText('Unsaved changes')).toBeNull();
      });

      const textareas = screen.getAllByRole('textbox');
      fireEvent.change(textareas[0], { target: { value: 'x' } });

      await screen.findByText('Unsaved changes');
    });
  });
});
