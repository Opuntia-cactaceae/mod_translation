import { describe, it, expect } from 'vitest';
import {
  getDateBucket,
  getDateBucketKey,
  groupByDateBucket,
  getJobSortTimestamp,
  formatMonthBucket,
} from '../dateGrouping';
import type { JobModel } from '../../domain/jobs';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

function makeJob(overrides: Partial<JobModel> & { id: string }): JobModel {
  return {
    name: '',
    status: 'completed' as const,
    filePaths: [],
    config: null,
    totalUnits: 0,
    completedUnits: 0,
    failedUnits: 0,
    cachedUnits: 0,
    progress: 100,
    currentBatchIndex: 0,
    totalBatches: 0,
    diagnostics: [],
    outputFiles: [],
    outputRootDir: undefined,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  getDateBucket                                                      */
/* ------------------------------------------------------------------ */

describe('getDateBucket', () => {
  const now = makeDate(2026, 5, 19); // May 19, 2026 (Tuesday)

  it('returns "Today" for the same calendar day', () => {
    expect(getDateBucket(makeDate(2026, 5, 19), now)).toBe('Today');
  });

  it('returns "Yesterday" for the previous calendar day', () => {
    expect(getDateBucket(makeDate(2026, 5, 18), now)).toBe('Yesterday');
  });

  it('returns "This week" for the same week (Mon-Sun), not today/yesterday', () => {
    // May 19, 2026 is a Tuesday. Monday May 18 = yesterday,
    // so "This week" starts from Sunday May 17? Wait, let me recalculate.
    // Actually, let me check: May 19, 2026
    // Using a different reference day to make it clearer:
    const testNow = makeDate(2026, 5, 21); // Thursday May 21
    // Monday May 18 is "This week" (same week, not today/yesterday)
    expect(getDateBucket(makeDate(2026, 5, 18), testNow)).toBe('This week');
    // Tuesday May 19 is "This week"
    expect(getDateBucket(makeDate(2026, 5, 19), testNow)).toBe('This week');
    // Wednesday May 20 is "Yesterday"
    expect(getDateBucket(makeDate(2026, 5, 20), testNow)).toBe('Yesterday');
    // Thursday May 21 is "Today"
    expect(getDateBucket(makeDate(2026, 5, 21), testNow)).toBe('Today');
  });

  it('returns "Earlier this month" for same month, outside this week', () => {
    // May 1, 2026 is earlier in the month
    const testNow = makeDate(2026, 5, 21); // May 21
    // May 1: same month, not this week (more than daysSinceMonday away)
    expect(getDateBucket(makeDate(2026, 5, 1), testNow)).toBe('Earlier this month');
  });

  it('returns "Month Year" for previous months', () => {
    expect(getDateBucket(makeDate(2026, 4, 15), now)).toBe('April 2026');
    expect(getDateBucket(makeDate(2026, 3, 1), now)).toBe('March 2026');
    expect(getDateBucket(makeDate(2025, 12, 25), now)).toBe('December 2025');
  });

  it('returns "Unknown date" for null/undefined/invalid dates', () => {
    expect(getDateBucket(null, now)).toBe('Unknown date');
    expect(getDateBucket(undefined, now)).toBe('Unknown date');
    expect(getDateBucket(new Date('invalid'), now)).toBe('Unknown date');
  });
});

/* ------------------------------------------------------------------ */
/*  getDateBucketKey                                                    */
/* ------------------------------------------------------------------ */

describe('getDateBucketKey', () => {
  const now = makeDate(2026, 5, 19); // May 19, 2026 (Tuesday)

  it('returns "today" for the same calendar day', () => {
    expect(getDateBucketKey(makeDate(2026, 5, 19), now)).toBe('today');
  });

  it('returns "yesterday" for the previous calendar day', () => {
    expect(getDateBucketKey(makeDate(2026, 5, 18), now)).toBe('yesterday');
  });

  it('returns "last-7-days" for the same week, not today/yesterday', () => {
    const testNow = makeDate(2026, 5, 21); // Thursday May 21
    // Monday May 18 is "last-7-days" (same week, not today/yesterday)
    expect(getDateBucketKey(makeDate(2026, 5, 18), testNow)).toBe('last-7-days');
    // Tuesday May 19 is "last-7-days"
    expect(getDateBucketKey(makeDate(2026, 5, 19), testNow)).toBe('last-7-days');
  });

  it('returns "earlier-this-month" for same month, outside this week', () => {
    const testNow = makeDate(2026, 5, 21); // May 21
    expect(getDateBucketKey(makeDate(2026, 5, 1), testNow)).toBe('earlier-this-month');
  });

  it('returns "month:YYYY-MM" for previous months', () => {
    expect(getDateBucketKey(makeDate(2026, 4, 15), now)).toBe('month:2026-04');
    expect(getDateBucketKey(makeDate(2026, 3, 1), now)).toBe('month:2026-03');
    expect(getDateBucketKey(makeDate(2025, 12, 25), now)).toBe('month:2025-12');
  });

  it('returns "unknown" for null/undefined/invalid dates', () => {
    expect(getDateBucketKey(null, now)).toBe('unknown');
    expect(getDateBucketKey(undefined, now)).toBe('unknown');
    expect(getDateBucketKey(new Date('invalid'), now)).toBe('unknown');
  });
});

/* ------------------------------------------------------------------ */
/*  formatMonthBucket                                                  */
/* ------------------------------------------------------------------ */

describe('formatMonthBucket', () => {
  it('formats as "Month YYYY"', () => {
    expect(formatMonthBucket(makeDate(2026, 4, 15))).toBe('April 2026');
    expect(formatMonthBucket(makeDate(2025, 12, 1))).toBe('December 2025');
    expect(formatMonthBucket(makeDate(2026, 1, 1))).toBe('January 2026');
  });
});

/* ------------------------------------------------------------------ */
/*  getJobSortTimestamp                                                */
/* ------------------------------------------------------------------ */

describe('getJobSortTimestamp', () => {
  it('prefers completed_at over updated_at and created_at', () => {
    const job = makeJob({
      id: 'test',
      completedAt: '2026-05-19T10:00:00Z',
      updatedAt: '2026-05-18T10:00:00Z',
      createdAt: '2026-05-17T10:00:00Z',
    });
    const ts = getJobSortTimestamp(job);
    expect(ts?.toISOString()).toBe(new Date('2026-05-19T10:00:00Z').toISOString());
  });

  it('falls back to updated_at when completed_at is missing', () => {
    const job = makeJob({
      id: 'test',
      completedAt: undefined,
      updatedAt: '2026-05-18T10:00:00Z',
      createdAt: '2026-05-17T10:00:00Z',
    });
    const ts = getJobSortTimestamp(job);
    expect(ts?.toISOString()).toBe(new Date('2026-05-18T10:00:00Z').toISOString());
  });

  it('falls back to created_at when completed_at and updated_at are missing', () => {
    const job = makeJob({
      id: 'test',
      completedAt: undefined,
      updatedAt: undefined,
      createdAt: '2026-05-17T10:00:00Z',
    });
    const ts = getJobSortTimestamp(job);
    expect(ts?.toISOString()).toBe(new Date('2026-05-17T10:00:00Z').toISOString());
  });

  it('returns null when no timestamps are available', () => {
    const job = makeJob({
      id: 'test',
      createdAt: undefined,
      updatedAt: undefined,
      completedAt: undefined,
    });
    expect(getJobSortTimestamp(job)).toBeNull();
  });

  it('returns null for invalid date strings', () => {
    const job = makeJob({
      id: 'test',
      createdAt: 'not-a-date',
    });
    expect(getJobSortTimestamp(job)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  groupByDateBucket                                                  */
/* ------------------------------------------------------------------ */

describe('groupByDateBucket', () => {
  it('groups items into correct buckets ordered newest first', () => {
    const now = makeDate(2026, 5, 21); // Thursday May 21
    const items = [
      { id: 'old', date: makeDate(2026, 3, 15) },
      { id: 'today', date: makeDate(2026, 5, 21) },
      { id: 'yesterday', date: makeDate(2026, 5, 20) },
      { id: 'thisWeek', date: makeDate(2026, 5, 18) }, // Monday same week
    ];

    const grouped = groupByDateBucket(
      items,
      (item) => item.date,
      now,
    );

    expect(grouped.length).toBeGreaterThanOrEqual(3);
    expect(grouped[0].bucket).toBe('Today');
    expect(grouped[0].items[0].id).toBe('today');
    expect(grouped[1].bucket).toBe('Yesterday');
    expect(grouped[1].items[0].id).toBe('yesterday');
    expect(grouped[2].bucket).toBe('This week');
    expect(grouped[2].items[0].id).toBe('thisWeek');
  });

  it('puts unknown dates last', () => {
    const now = makeDate(2026, 5, 21);
    const items = [
      { id: 'known', date: makeDate(2026, 5, 21) },
      { id: 'unknown', date: null },
    ];

    const grouped = groupByDateBucket(
      items,
      (item) => item.date,
      now,
    );

    expect(grouped[grouped.length - 1].bucket).toBe('Unknown date');
    expect(grouped[grouped.length - 1].items[0].id).toBe('unknown');
  });

  it('sorts items within a bucket by timestamp descending', () => {
    const now = makeDate(2026, 5, 21);
    // Use dates on different days for reliable sorting
    const items = [
      { id: 'may20', date: makeDate(2026, 5, 20) },
      { id: 'may19', date: makeDate(2026, 5, 19) },
      { id: 'may21', date: makeDate(2026, 5, 21) },
    ];

    const grouped = groupByDateBucket(
      items,
      (item) => item.date,
      now,
    );

    expect(grouped[0].bucket).toBe('Today');
    expect(grouped[0].items.map(i => i.id)).toEqual(['may21']);
    expect(grouped[1].bucket).toBe('Yesterday');
    expect(grouped[1].items.map(i => i.id)).toEqual(['may20']);
    // may19 ends up in "This week" since May 19 is the Monday of the week
    const thisWeek = grouped.find(g => g.bucket === 'This week');
    expect(thisWeek?.items.map(i => i.id)).toEqual(['may19']);
  });

  it('includes month buckets for previous months, newest first', () => {
    const now = makeDate(2026, 5, 21);
    const items = [
      { id: 'april', date: makeDate(2026, 4, 15) },
      { id: 'march', date: makeDate(2026, 3, 10) },
    ];

    const grouped = groupByDateBucket(
      items,
      (item) => item.date,
      now,
    );

    // Should have "April 2026" before "March 2026"
    const aprilIdx = grouped.findIndex(g => g.bucket === 'April 2026');
    const marchIdx = grouped.findIndex(g => g.bucket === 'March 2026');
    expect(aprilIdx).toBeGreaterThanOrEqual(0);
    expect(marchIdx).toBeGreaterThan(aprilIdx);
  });

  it('returns empty array for empty input', () => {
    const grouped = groupByDateBucket([], () => new Date());
    expect(grouped).toEqual([]);
  });
});
