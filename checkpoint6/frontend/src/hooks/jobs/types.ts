import type { JobModel } from "../../domain";

/* ------------------------------------------------------------------ */
/*  JobActionsApi — explicit interface for useJobActions return type    */
/* ------------------------------------------------------------------ */

export interface JobActionsApi {
  startingJobId: string | null;
  pausingJobId: string | null;
  resumingJobId: string | null;
  cancellingJobId: string | null;
  startJob: (job: JobModel) => Promise<void>;
  pauseJob: (job: JobModel) => Promise<void>;
  resumeJob: (job: JobModel) => Promise<void>;
  cancelJob: (job: JobModel) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  JobRecoveryApi — explicit interface for useJobRecovery return type  */
/* ------------------------------------------------------------------ */

export interface JobRecoveryApi {
  restartingJobId: string | null;
  retryingJobId: string | null;
  restartJob: (job: JobModel) => Promise<void>;
  retryFailedJob: (job: JobModel) => Promise<void>;
}
