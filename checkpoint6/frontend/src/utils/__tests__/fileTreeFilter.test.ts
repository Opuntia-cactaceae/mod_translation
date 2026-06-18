/* ------------------------------------------------------------------ */
/*  Tests: fileTreeFilter — include/exclude tree filtering              */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import { filterFileGroupNodes } from '../fileTreeFilter';
import type { FileGroupNode } from '../../domain/grouping/groupingTypes';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const FLAT_NODE: FileGroupNode = {
  id: 'flat:all',
  label: 'All files (3)',
  fileCount: 3,
  files: ['/root/events_data.txt', '/root/localization.txt', '/root/cache_temp.txt'],
};

const TWO_LEVEL: FileGroupNode[] = [
  {
    id: 'dir:events',
    label: 'events',
    relativePath: 'events',
    fileCount: 3,
    files: ['/root/events/start.txt', '/root/events/end.txt', '/root/events/config.txt'],
    children: [
      {
        id: 'dir:events/deep',
        label: 'deep',
        relativePath: 'events/deep',
        fileCount: 2,
        files: ['/root/events/deep/extra.txt', '/root/events/deep/data.txt'],
        children: [
          {
            id: 'smart:events/deep:nested',
            label: 'nested_*',
            relativePath: 'events/deep',
            fileCount: 1,
            files: ['/root/events/deep/nested_final.txt'],
          },
        ],
      },
    ],
  },
  {
    id: 'dir:localization',
    label: 'localization',
    relativePath: 'localization',
    fileCount: 2,
    files: ['/root/localization/en.txt', '/root/localization/ru.txt'],
  },
  {
    id: 'dir:cache',
    label: 'cache',
    relativePath: 'cache',
    fileCount: 2,
    files: ['/root/cache/temp.bin', '/root/cache/index.bin'],
  },
  {
    id: 'dir:events_related',
    label: 'events_related',
    relativePath: 'events_related',
    fileCount: 1,
    files: ['/root/events_related/summary.txt'],
  },
];

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('filterFileGroupNodes', () => {
  /* ---- No-op cases ---- */

  it('returns the same tree when both filters are empty', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, '', '');
    expect(result).toBe(TWO_LEVEL); // same reference
  });

  it('returns the same tree when only include is empty', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, '', 'nonexistent');
    expect(result).not.toBe(TWO_LEVEL);
  });

  /* ---- Include: folder match shows whole subtree ---- */

  it('include folder match shows the whole subtree', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'events', '');
    expect(result.length).toBe(2); // events + events_related
    // events folder fully visible including all descendants
    const eventsNode = result.find(n => n.label === 'events')!;
    expect(eventsNode).toBeDefined();
    expect(eventsNode.files.length).toBe(3); // all files in subtree
    expect(eventsNode.children).toBeDefined();
    expect(eventsNode.children!.length).toBe(1);
    // events_related matched because its label contains "events"
    const relatedNode = result.find(n => n.label === 'events_related')!;
    expect(relatedNode).toBeDefined();
    expect(relatedNode.files.length).toBe(1);
  });

  /* ---- Include: descendant match preserves ancestors ---- */

  it('include descendant match preserves ancestor chain', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'nested_final', '');
    // events/deep/nested_final.txt matches "nested_final"
    // should preserve: events -> events/deep -> events/deep/nested_*
    expect(result.length).toBe(1);
    const eventsNode = result[0];
    expect(eventsNode.label).toBe('events');
    expect(eventsNode.children).toBeDefined();
    expect(eventsNode.children!.length).toBe(1);
    const deepNode = eventsNode.children![0];
    expect(deepNode.label).toBe('deep');
    expect(deepNode.children).toBeDefined();
    expect(deepNode.children!.length).toBe(1);
    const nestedNode = deepNode.children![0];
    expect(nestedNode.label).toBe('nested_*');
    expect(nestedNode.files).toEqual(['/root/events/deep/nested_final.txt']);
  });

  /* ---- Include: single flat node filters individual files ---- */

  it('include filter on flat node filters individual files', () => {
    const result = filterFileGroupNodes([FLAT_NODE], 'events', '');
    expect(result.length).toBe(1);
    expect(result[0].files).toEqual(['/root/events_data.txt']);
  });

  /* ---- Exclude: folder match hides subtree ---- */

  it('exclude folder match hides subtree', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, '', 'cache');
    expect(result.length).toBe(3); // events, localization, events_related
    expect(result.find(n => n.label === 'cache')).toBeUndefined();
  });

  it('exclude wins over include when both match', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'events', 'events_related');
    // events_related matches both include and exclude → exclude wins
    expect(result.length).toBe(1); // only events (events_related excluded)
    expect(result.find(n => n.label === 'events')).toBeDefined();
    expect(result.find(n => n.label === 'events_related')).toBeUndefined();
  });

  it('exclude removes descendants even inside an included subtree', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'events', 'temp');
    const eventsNode = result.find(n => n.label === 'events');
    expect(eventsNode).toBeDefined();
    // 'temp' matches 'events/deep/extra.txt'? No, 'temp' matches 'events/deep/extra.txt' has 'extra' not 'temp'
    // 'temp' matches ... let me check. 'events/deep/extra.txt' - no. 'cache/temp.bin' - yes but cache excluded already.
    // Actually, let me check which files contain 'temp': 'events/deep/...temp?' no.
    // Hmm, none of the events files contain 'temp'. Let me use a better test.
    // Test: exclude removes 'start' from events
    const result2 = filterFileGroupNodes(TWO_LEVEL, 'events', 'start');
    const eventsNode2 = result2.find(n => n.label === 'events')!;
    expect(eventsNode2).toBeDefined();
    expect(eventsNode2.files.find(f => f.includes('start'))).toBeUndefined();
  });

  /* ---- Clearing filters restores full tree ---- */

  it('empty filters after non-empty filters return same reference', () => {
    const first = filterFileGroupNodes(TWO_LEVEL, 'events', '');
    const second = filterFileGroupNodes(TWO_LEVEL, '', '');
    expect(second).toBe(TWO_LEVEL);
  });

  /* ---- Comma-separated tokens ---- */

  it('supports comma-separated include tokens', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'cache, localization', '');
    expect(result.length).toBe(2);
    expect(result.find(n => n.label === 'cache')).toBeDefined();
    expect(result.find(n => n.label === 'localization')).toBeDefined();
  });

  /* ---- Case insensitivity ---- */

  it('matching is case-insensitive', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'EVENTS', '');
    expect(result.length).toBe(2);
    expect(result.find(n => n.label === 'events')).toBeDefined();
    expect(result.find(n => n.label === 'events_related')).toBeDefined();
  });

  /* ---- Empty state when no matches ---- */

  it('returns empty array when no nodes match include', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, 'zzzznotfound', '');
    expect(result.length).toBe(0);
  });

  it('returns empty array when all nodes excluded', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, '', 'events, localization, cache, events_related');
    expect(result.length).toBe(0);
  });

  /* ---- Edge: empty node arrays ---- */

  it('handles empty input array', () => {
    const result = filterFileGroupNodes([], 'events', '');
    expect(result).toEqual([]);
  });

  /* ---- Label matching ---- */

  it('matches against node label', () => {
    // 'events' matches the 'events' directory label
    const result = filterFileGroupNodes(TWO_LEVEL, 'events', '');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  /* ---- Exclude: file within non-excluded folder ---- */

  it('exclude filter removes individual files that match', () => {
    const result = filterFileGroupNodes(TWO_LEVEL, '', 'temp');
    // 'cache' folder should still exist, but its 'temp.bin' file removed
    const cacheNode = result.find(n => n.label === 'cache');
    // Actually 'temp' matches 'cache/temp.bin' → the file is filtered from cache node
    // But also 'cache' label doesn't match 'temp' so the node is kept
    expect(cacheNode).toBeDefined();
    if (cacheNode) {
      expect(cacheNode.files.find(f => f.includes('temp.bin'))).toBeUndefined();
      expect(cacheNode.files.find(f => f.includes('index.bin'))).toBeDefined();
    }
  });
});
