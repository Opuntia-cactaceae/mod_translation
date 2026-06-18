import { useState, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useTraceSelection() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const openTrace = useCallback((jobId: string) => {
    setSelectedJobId(jobId);
  }, []);

  const closeTrace = useCallback(() => {
    setSelectedJobId(null);
  }, []);

  return {
    selectedJobId,
    openTrace,
    closeTrace,
    setSelectedJobId,
  };
}
