import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import type { JobModel } from '../../../domain';

/* ------------------------------------------------------------------ */
/*  Cleanup                                                             */
/* ------------------------------------------------------------------ */

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  Fixture                                                             */
/* ------------------------------------------------------------------ */

function createJob(overrides: Partial<JobModel> = {}): JobModel {
  return {
    id: 'job-001',
    name: 'Test Job',
    status: 'completed',
    filePaths: ['/source/file.yml'],
    config: null,
    totalUnits: 100,
    completedUnits: 100,
    failedUnits: 0,
    cachedUnits: 0,
    progress: 100,
    createdAt: '2025-01-01T12:00:00Z',
    currentBatchIndex: 5,
    totalBatches: 5,
    diagnostics: [],
    outputFiles: ['/output/translated_file.yml'],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

interface OutputFilesSectionProps {
  job?: JobModel;
  onRevealPath?: (path: string) => void;
  onOpenEditor?: (path: string) => void;
}

async function renderSection(props: OutputFilesSectionProps = {}) {
  const JobOutputFilesSection = (await import('../JobOutputFilesSection')).default;
  const job = props.job ?? createJob();
  return render(
    React.createElement(JobOutputFilesSection, {
      job,
      onRevealPath: props.onRevealPath,
      onOpenEditor: props.onOpenEditor,
    })
  );
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('JobOutputFilesSection', () => {
  /* ------------------------------------------------------------------ */
  /*  Rendering                                                         */
  /* ------------------------------------------------------------------ */

  describe('rendering', () => {
    it('renders section title', async () => {
      await renderSection();
      expect(screen.getByText('Output Files')).toBeTruthy();
    });

    it('displays output file paths', async () => {
      const job = createJob({ outputFiles: ['/output/translated_file.yml'] });
      await renderSection({ job });
      expect(screen.getByText('/output/translated_file.yml')).toBeTruthy();
    });

    it('displays multiple output files', async () => {
      const job = createJob({
        outputFiles: ['/out/a.yml', '/out/b.yml', '/out/c.yml'],
      });
      await renderSection({ job });
      expect(screen.getByText('/out/a.yml')).toBeTruthy();
      expect(screen.getByText('/out/b.yml')).toBeTruthy();
      expect(screen.getByText('/out/c.yml')).toBeTruthy();
    });

    it('returns null when outputFiles is empty', async () => {
      const job = createJob({ outputFiles: [] });
      const { container } = await renderSection({ job });
      expect(container.innerHTML).toBe('');
    });

    it('renders action buttons for each file', async () => {
      const job = createJob({ outputFiles: ['/out/a.yml'] });
      await renderSection({ job, onRevealPath: vi.fn(), onOpenEditor: vi.fn() });
      expect(screen.getByText('Open output folder')).toBeTruthy();
      expect(screen.getByText('Open translated file')).toBeTruthy();
      expect(screen.getByText('Open in editor')).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Multi-file collapse                                                */
  /* ------------------------------------------------------------------ */

  describe('multi-file collapse', () => {
    it('shows max 20 files by default', async () => {
      const files = Array.from({ length: 25 }, (_, i) => `/out/file${i}.yml`);
      const job = createJob({ outputFiles: files });
      await renderSection({ job });
      // 20 visible + "Show all (25 files)" button
      expect(screen.getByText('Show all (25 files)')).toBeTruthy();
    });

    it('shows all files when "Show all" is clicked', async () => {
      const files = Array.from({ length: 25 }, (_, i) => `/out/file${i}.yml`);
      const job = createJob({ outputFiles: files });
      await renderSection({ job });
      fireEvent.click(screen.getByText('Show all (25 files)'));
      // The "Show less" button should now appear
      expect(screen.getByText('Show less')).toBeTruthy();
    });

    it('does not show Show all button when files <= 20', async () => {
      const files = Array.from({ length: 5 }, (_, i) => `/out/file${i}.yml`);
      const job = createJob({ outputFiles: files });
      await renderSection({ job });
      expect(screen.queryByText(/Show all/)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Action buttons                                                     */
  /* ------------------------------------------------------------------ */

  describe('action buttons', () => {
    it('calls onRevealPath with parent dir for "Open output folder"', async () => {
      const onRevealPath = vi.fn();
      const job = createJob({ outputFiles: ['/output/subdir/file.yml'] });
      await renderSection({ job, onRevealPath });
      fireEvent.click(screen.getByText('Open output folder'));
      expect(onRevealPath).toHaveBeenCalledWith('/output/subdir');
    });

    it('calls onRevealPath with file path for "Open translated file"', async () => {
      const onRevealPath = vi.fn();
      const job = createJob({ outputFiles: ['/output/file.yml'] });
      await renderSection({ job, onRevealPath });
      fireEvent.click(screen.getByText('Open translated file'));
      expect(onRevealPath).toHaveBeenCalledWith('/output/file.yml');
    });

    it('calls onOpenEditor with file path', async () => {
      const onOpenEditor = vi.fn();
      const job = createJob({ outputFiles: ['/output/file.yml'] });
      await renderSection({ job, onOpenEditor });
      fireEvent.click(screen.getByText('Open in editor'));
      expect(onOpenEditor).toHaveBeenCalledWith('/output/file.yml');
    });

    it('hides buttons when callbacks are not provided', async () => {
      const job = createJob({ outputFiles: ['/out/file.yml'] });
      await renderSection({ job });
      expect(screen.queryByText('Open output folder')).toBeNull();
      expect(screen.queryByText('Open translated file')).toBeNull();
      expect(screen.queryByText('Open in editor')).toBeNull();
    });
  });
});
