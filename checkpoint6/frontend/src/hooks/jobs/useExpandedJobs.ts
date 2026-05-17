import { useState, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseExpandedJobsOptions {
  /** Called when a job row is collapsed. Useful for clearing related state. */
  onCollapse?: (jobId: string) => void;
}

export function useExpandedJobs(options?: UseExpandedJobsOptions) {
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});

  const toggleJobExpand = useCallback((jobId: string) => {
    setExpandedJobs(prev => {
      const wasExpanded = !!prev[jobId];
      if (wasExpanded && options?.onCollapse) {
        options.onCollapse(jobId);
      }
      return { ...prev, [jobId]: !wasExpanded };
    });
  }, [options?.onCollapse]);

  const collapseAll = useCallback(() => {
    setExpandedJobs({});
  }, []);

  return { expandedJobs, toggleJobExpand, collapseAll };
}
