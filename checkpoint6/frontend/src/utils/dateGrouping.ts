/* ------------------------------------------------------------------ */
/*  Date grouping helpers                                              */
/* ------------------------------------------------------------------ */

import type { JobModel } from '../domain/jobs';

/**
 * Return a date bucket label for a date relative to `now`.
 *
 * Buckets: Today | Yesterday | This week | Earlier this month | Month Year | Unknown date
 */
export function getDateBucket(date: Date | null | undefined, now: Date): string {
  if (!date || !isValidDate(date)) return 'Unknown date';

  const today = startOfDay(now);
  const target = startOfDay(date);

  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  // "This week" = Mon-Sun week containing today, excluding today/yesterday
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ...
  if (diffDays >= 2 && diffDays <= daysSinceMonday) return 'This week';

  // "Earlier this month" = same calendar month, not covered above
  if (sameCalendarMonth(date, now)) return 'Earlier this month';

  // Otherwise: "April 2026"
  return formatMonthBucket(date);
}

/**
 * Return a stable bucket key for a date relative to `now`.
 *
 * Keys: today | yesterday | last-7-days | earlier-this-month | month:YYYY-MM | unknown
 *
 * Use this for persisting group collapse state so it survives locale changes.
 */
export function getDateBucketKey(date: Date | null | undefined, now: Date): string {
  if (!date || !isValidDate(date)) return 'unknown';

  const today = startOfDay(now);
  const target = startOfDay(date);

  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';

  const dayOfWeek = today.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  if (diffDays >= 2 && diffDays <= daysSinceMonday) return 'last-7-days';

  if (sameCalendarMonth(date, now)) return 'earlier-this-month';

  return `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Group items into date bucket sections, sorted newest-first.
 * Within each bucket, items are sorted by timestamp descending.
 */
export interface DateBucketGroup<T> {
  /** Display label (e.g. "Today", "April 2026") */
  bucket: string;
  /** Stable key for persistence (e.g. "today", "month:2026-04") */
  bucketKey: string;
  items: T[];
}

export function groupByDateBucket<T>(
  items: T[],
  getDate: (item: T) => Date | null | undefined,
  now: Date = new Date(),
): DateBucketGroup<T>[] {
  const bucketOrder = [
    'Today',
    'Yesterday',
    'This week',
    'Earlier this month',
  ];

  // Map from bucket label -> { label, key, items }
  const buckets = new Map<string, { label: string; key: string; items: T[] }>();

  for (const item of items) {
    const date = getDate(item);
    const label = getDateBucket(date, now);
    const key = getDateBucketKey(date, now);
    if (!buckets.has(label)) {
      buckets.set(label, { label, key, items: [] });
    }
    buckets.get(label)!.items.push(item);
  }

  // Sort within each bucket by timestamp descending
  for (const [, group] of buckets) {
    group.items.sort((a, b) => {
      const da = getDate(a)?.getTime() ?? 0;
      const db = getDate(b)?.getTime() ?? 0;
      return db - da;
    });
  }

  // Build result: ordered buckets first, then month buckets sorted, then Unknown
  const result: DateBucketGroup<T>[] = [];

  for (const label of bucketOrder) {
    if (buckets.has(label)) {
      const g = buckets.get(label)!;
      result.push({ bucket: g.label, bucketKey: g.key, items: g.items });
      buckets.delete(label);
    }
  }

  // Remaining keys are month names — sort them newest first
  const monthLabels = Array.from(buckets.keys())
    .filter(k => k !== 'Unknown date')
    .sort((a, b) => {
      // Parse "April 2026" format
      const da = new Date(a);
      const db = new Date(b);
      return db.getTime() - da.getTime();
    });

  for (const label of monthLabels) {
    const g = buckets.get(label)!;
    result.push({ bucket: g.label, bucketKey: g.key, items: g.items });
    buckets.delete(label);
  }

  // Unknown date last
  if (buckets.has('Unknown date')) {
    const g = buckets.get('Unknown date')!;
    result.push({ bucket: g.label, bucketKey: g.key, items: g.items });
  }

  return result;
}

/**
 * Return the best sort timestamp for a job.
 *
 * Priority: completed_at > updated_at > created_at
 */
export function getJobSortTimestamp(job: JobModel): Date | null {
  const raw = job.completedAt || job.updatedAt || job.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return isValidDate(d) ? d : null;
}

/**
 * Format a date as "Month YYYY" (e.g., "April 2026").
 */
export function formatMonthBucket(date: Date): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime());
}

function sameCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
