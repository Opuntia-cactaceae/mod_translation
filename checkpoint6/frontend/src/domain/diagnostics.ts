/* ------------------------------------------------------------------ */
/*  Diagnostic helpers                                                 */
/* ------------------------------------------------------------------ */

export type DiagnosticLevel = "info" | "warning" | "error";

type DiagnosticLike = {
  level?: string;
  message?: string;
  [key: string]: unknown;
};

/* ------------------------------------------------------------------ */
/*  DiagnosticItem — raw diagnostic from the API                       */
/* ------------------------------------------------------------------ */

export interface DiagnosticItem {
  level: string;
  message: string;
  code?: string;
}

/**
 * Guard that maps an unknown value to a DiagnosticItem.
 * Returns null if the value is not a valid diagnostic object.
 */
export function mapDiagnosticItem(raw: unknown): DiagnosticItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.level !== "string" || typeof r.message !== "string") return null;
  return {
    level: r.level,
    message: r.message,
    code: typeof r.code === "string" ? r.code : undefined,
  };
}

export function mapDiagnosticItems(raw: unknown[]): DiagnosticItem[] {
  return (raw ?? []).reduce<DiagnosticItem[]>((acc, item) => {
    const mapped = mapDiagnosticItem(item);
    if (mapped) acc.push(mapped);
    return acc;
  }, []);
}

/* ------------------------------------------------------------------ */
/*  DiagnosticModel — fully typed diagnostic                           */
/* ------------------------------------------------------------------ */

export interface DiagnosticModel {
  level: DiagnosticLevel;
  message: string;
  category: string;
  badgeClass: string;
  humanLabel: string;
}

const LEVEL_BADGE: Record<string, string> = {
  error: "badge-error",
  critical: "badge-error",
  warning: "badge-warning",
  info: "badge-info",
};

const LEVEL_LABEL: Record<string, string> = {
  error: "Error",
  critical: "Error",
  warning: "Warning",
  info: "Info",
};

export function mapDiagnostic(d: unknown): DiagnosticModel {
  const level = getDiagnosticLevel(d);
  const message = getDiagnosticMessage(d);
  const dObj = (d ?? {}) as DiagnosticLike;
  return {
    level,
    message,
    category: dObj.code ? String(dObj.code) : level,
    badgeClass: LEVEL_BADGE[dObj.level ?? ""] || "badge-info",
    humanLabel: LEVEL_LABEL[dObj.level ?? ""] || "Info",
  };
}

export function mapDiagnostics(diags: unknown[]): DiagnosticModel[] {
  return (diags ?? []).map(mapDiagnostic);
}

/**
 * Normalise a diagnostic object to a standard level.
 * Maps 'critical' → 'error', everything else falls back to 'info'.
 */
export function getDiagnosticLevel(diagnostic: unknown): DiagnosticLevel {
  if (!diagnostic || typeof diagnostic !== "object") return "info";
  const d = diagnostic as DiagnosticLike;
  if (d.level === "error" || d.level === "critical") return "error";
  if (d.level === "warning") return "warning";
  return "info";
}

/**
 * Extract a human-readable message from a diagnostic object.
 */
export function getDiagnosticMessage(diagnostic: unknown): string {
  if (!diagnostic || typeof diagnostic !== "object") return String(diagnostic ?? "");
  const d = diagnostic as DiagnosticLike;
  if (typeof d.message === "string") return d.message;
  return JSON.stringify(d);
}
