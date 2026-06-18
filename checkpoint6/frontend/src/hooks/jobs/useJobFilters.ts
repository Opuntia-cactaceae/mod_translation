import { useMemo, useCallback } from 'react';
import { usePersistentState } from '../usePersistentState';
import type { JobModel } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface JobFilters {
  search: string;
  status: string;
}

interface UseJobFiltersOptions {
  storageKey: string;
  defaultFilters?: JobFilters;
  legacyKeys?: string[];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useJobFilters(jobs: JobModel[], options: UseJobFiltersOptions) {
  const {
    storageKey,
    defaultFilters = { search: '', status: 'all' },
    legacyKeys,
  } = options;

  const [filters, setFilters] = usePersistentState<JobFilters>(
    storageKey,
    defaultFilters,
    legacyKeys ? { legacyKeys } : undefined,
  );

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (filters.status !== 'all' && job.status !== filters.status) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!job.name.toLowerCase().includes(q) && !job.id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filters]);

  const setSearch = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, search }));
  }, [setFilters]);

  const setStatus = useCallback((status: string) => {
    setFilters(prev => ({ ...prev, status }));
  }, [setFilters]);

  return {
    filters,
    setFilters,
    setSearch,
    setStatus,
    filteredJobs,
  };
}
