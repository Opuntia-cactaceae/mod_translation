import type { JobResponse, JobSummaryResponse } from "../api/types";
import { mapDiagnosticItems, type DiagnosticItem } from "./diagnostics";

/* ------------------------------------------------------------------ */
/*  Domain types                                                       */
/* ------------------------------------------------------------------ */

export type JobStatus =
  | "pending"
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface OutputFileInfo {
  outputPath: string;
}

export interface JobModel {
  id: string;
  name: string;
  status: JobStatus;
  filePaths: string[];
  config: Record<string, unknown> | null;
  totalUnits: number;
  completedUnits: number;
  failedUnits: number;
  cachedUnits: number;
  progress: number;
  createdAt?: string;
  updatedAt?: string;
  /* --- Extended fields --- */
  errorMessage?: string;
  currentBatchIndex: number;
  totalBatches: number;
  diagnostics: DiagnosticItem[];
  resultSummary?: { outputFiles: OutputFileInfo[] } | null;
  currentActivity?: string;
  /* --- Output files --- */
  outputFiles: string[];
  outputRootDir?: string;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mapper                                                */
/* ------------------------------------------------------------------ */

export function mapJobResponse(dto: JobResponse): JobModel {
  const rawOutputFiles = dto.result_summary?.output_files;
  const legacyOutputFiles: OutputFileInfo[] = Array.isArray(rawOutputFiles)
    ? rawOutputFiles.map((of) => ({ outputPath: of.output_path ?? String(of) }))
    : [];

  return {
    id: dto.id,
    name: dto.name,
    status: dto.status as JobStatus,
    filePaths: [...dto.file_paths],
    config: dto.config ?? null,
    totalUnits: dto.total_units,
    completedUnits: dto.completed_units,
    failedUnits: dto.failed_units,
    cachedUnits: dto.cached_units,
    progress: dto.progress,
    createdAt: dto.created_at || undefined,
    updatedAt: dto.updated_at || undefined,
    errorMessage: dto.error_message || undefined,
    currentBatchIndex: dto.current_batch_index ?? 0,
    totalBatches: dto.total_batches ?? 0,
    diagnostics: mapDiagnosticItems(dto.diagnostics ?? []),
    resultSummary: legacyOutputFiles.length > 0 ? { outputFiles: legacyOutputFiles } : null,
    currentActivity: dto.current_activity || undefined,
    outputFiles: [...(dto.output_files ?? [])],
    outputRootDir: dto.output_root_dir ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Job status helpers (accept both JobModel and JobResponse)          */
/* ------------------------------------------------------------------ */

type JobLike = { status: string; failed_units?: number; failedUnits?: number };

function getFailedUnits(job: JobLike): number {
  return job.failedUnits ?? job.failed_units ?? 0;
}

export function isJobRunning(job: JobLike): boolean {
  return job.status === "running";
}

export function isJobTerminal(job: JobLike): boolean {
  return (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  );
}

export function canStartJob(job: JobLike): boolean {
  return job.status === "pending";
}

export function canPauseJob(job: JobLike): boolean {
  return job.status === "running";
}

export function canResumeJob(job: JobLike): boolean {
  return job.status === "paused";
}

export function canCancelJob(job: JobLike): boolean {
  return (
    job.status === "running" ||
    job.status === "paused" ||
    job.status === "pending"
  );
}

export function canRestartJob(job: JobLike): boolean {
  return (
    job.status === "failed" ||
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "paused"
  );
}

export function canShowRetry(job: JobLike): boolean {
  return (
    job.status === "failed" ||
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "paused"
  );
}

export function canRetryFailed(job: JobLike): boolean {
  return canShowRetry(job) && getFailedUnits(job) > 0;
}

/* ------------------------------------------------------------------ */
/*  Domain helpers (JobModel-specific, no snake_case leakage)          */
/* ------------------------------------------------------------------ */

export function hasFailedUnits(job: JobModel): boolean {
  return job.failedUnits > 0;
}

export function hasOutputFiles(job: JobModel): boolean {
  return Array.isArray(job.outputFiles) && job.outputFiles.length > 0;
}

export function isJobRecoverable(job: JobModel): boolean {
  return canRestartJob(job) || canRetryFailed(job);
}

export function getProcessedUnits(job: JobModel): number {
  return job.completedUnits + job.failedUnits + job.cachedUnits;
}

export function getJobCompletionState(job: JobModel): "success" | "with_errors" | null {
  if (job.status !== "completed") return null;
  return job.failedUnits > 0 ? "with_errors" : "success";
}

export function getOutputFiles(job: JobModel): OutputFileInfo[] {
  return job.outputFiles.map((p) => ({ outputPath: p }));
}

/* ------------------------------------------------------------------ */
/*  Summary merge helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Merge lightweight summary fields into existing JobModel[] by id.
 *
 * Updates only: status, progress, completedUnits, failedUnits, cachedUnits,
 * currentBatchIndex, totalBatches, updatedAt, activeWorker, errorMessage.
 *
 * Preserves: filePaths, config, resultSummary, diagnostics, name, createdAt,
 * outputFiles, outputRootDir, currentActivity.
 */
export function mergeJobSummaries(
  jobs: JobModel[],
  summaries: JobSummaryResponse[],
): JobModel[] {
  const summaryMap = new Map(summaries.map((s) => [s.id, s]));
  return jobs.map((job) => {
    const summary = summaryMap.get(job.id);
    if (!summary) return job;
    return {
      ...job,
      status: summary.status as JobStatus,
      progress: summary.progress,
      completedUnits: summary.completed_units,
      failedUnits: summary.failed_units,
      cachedUnits: summary.cached_units,
      currentBatchIndex: summary.current_batch_index,
      totalBatches: summary.total_batches,
      updatedAt: summary.updated_at || undefined,
      errorMessage: summary.error_message || undefined,
    };
  });
}
