/* ------------------------------------------------------------------ */
/*  useTranslateDiscoveryFiles — unified orchestration for translate    */
/*                                                                      */
/*  Single entry-point for ALL "translate" actions from discovery       */
/*  sections (GenericFileSection, ModListSection).                      */
/*                                                                      */
/*  Flow:                                                               */
/*    1. Collect files                                                  */
/*    2. Check for existing jobs with same file set (duplicate detect)  */
/*    3. Add new files to the shared draft system                       */
/*    4. Navigate to /jobs (or return existing job info)                */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../App';
import { useDraftJobSelectionApi } from './useDraftJobSelectionApi';
import { mapJobResponse, type JobModel } from '../domain/jobs';
import { normalizePath } from '../utils/genericFileGrouping';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TranslateOptions {
  /** Files to translate. */
  files: string[];
  /** Game/mod identifier for draft metadata. */
  gameId: string;
  /** Human-readable label for draft metadata. */
  gameLabel: string;
}

export interface DuplicateJobInfo {
  /** Jobs whose file set is identical to the requested files. */
  duplicateJobs: JobModel[];
  /** Whether duplicates were found during the last translate call. */
  hasDuplicates: boolean;
}

export interface TranslateResult {
  /** The first duplicate job found (if any). */
  existingJobId: string | null;
  /** Whether a duplicate was detected. */
  isDuplicate: boolean;
  /** Whether navigation to /jobs happened. */
  navigated: boolean;
  /** Files that were actually added to the draft (after dedup). */
  addedFiles: string[];
  /** Files that were skipped (already in draft). */
  skippedFiles: string[];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTranslateDiscoveryFiles() {
  const toast = useToast();
  const navigate = useNavigate();
  const draftApi = useDraftJobSelectionApi();

  /* ---- Race-condition guards ---- */
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateJobInfo>({
    duplicateJobs: [],
    hasDuplicates: false,
  });

  /**
   * Normalize and compare two file path arrays.
   * Returns true if they contain the same set of paths (order-independent).
   */
  const fileSetsMatch = useCallback((a: string[], b: string[]): boolean => {
    if (a.length !== b.length) return false;
    const normA = new Set(a.map(normalizePath));
    for (const fp of b) {
      if (!normA.has(normalizePath(fp))) return false;
    }
    return true;
  }, []);

  /**
   * Fetch all existing jobs and match against a file set.
   * Returns jobs whose file_paths match exactly (set comparison).
   */
  const checkExistingJobs = useCallback(async (
    filePaths: string[],
  ): Promise<JobModel[]> => {
    try {
      const response = await api.listJobs();
      return response
        .map(mapJobResponse)
        .filter(job => fileSetsMatch(job.filePaths, filePaths));
    } catch {
      return [];
    }
  }, [fileSetsMatch]);

  /**
   * Translate files: add to draft, check duplicates, navigate to /jobs.
   *
   * Returns info about duplicates found and what was added.
   * Callers can use this to show confirmation dialogs before proceeding.
   */
  const translateAll = useCallback(async (
    options: TranslateOptions,
    skipDuplicateCheck = false,
  ): Promise<TranslateResult> => {
    const { files, gameId, gameLabel } = options;

    // Increment request counter — any stale in-flight response will be ignored
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (files.length === 0) {
      toast.showToast('No files to translate', 'error');
      return { existingJobId: null, isDuplicate: false, navigated: false, addedFiles: [], skippedFiles: [] };
    }

    // 1. Check for existing jobs (duplicate detection)
    let duplicateJobs: JobModel[] = [];
    if (!skipDuplicateCheck) {
      duplicateJobs = await checkExistingJobs(files);
    }

    // Guard: ignore stale responses after a newer request or unmount
    if (!mountedRef.current || requestId !== requestIdRef.current) {
      return { existingJobId: null, isDuplicate: false, navigated: false, addedFiles: [], skippedFiles: [] };
    }

    // 2. Add new files to draft (skip already-added ones)
    const newPaths: string[] = [];
    const skippedPaths: string[] = [];
    for (const fp of files) {
      if (draftApi.isFileAdded(fp)) {
        skippedPaths.push(fp);
      } else {
        newPaths.push(fp);
      }
    }

    if (newPaths.length > 0 && mountedRef.current) {
      draftApi.addFiles(newPaths, { modId: gameId, modName: gameLabel });
    }

    // 3. Update duplicate info state (only if still the active request)
    if (duplicateJobs.length > 0 && mountedRef.current && requestId === requestIdRef.current) {
      setDuplicateInfo({ duplicateJobs, hasDuplicates: true });
    }

    // 4. Navigate to /jobs (only if still mounted)
    if (mountedRef.current) {
      navigate('/jobs');
    }

    return {
      existingJobId: duplicateJobs.length > 0 ? duplicateJobs[0].id : null,
      isDuplicate: duplicateJobs.length > 0,
      navigated: true,
      addedFiles: newPaths,
      skippedFiles: skippedPaths,
    };
  }, [navigate, toast, draftApi, checkExistingJobs]);

  /**
   * Reset duplicate detection state.
   */
  const clearDuplicateInfo = useCallback(() => {
    setDuplicateInfo({ duplicateJobs: [], hasDuplicates: false });
  }, []);

  return {
    translateAll,
    checkExistingJobs,
    duplicateInfo,
    setDuplicateInfo,
    clearDuplicateInfo,
  };
}
