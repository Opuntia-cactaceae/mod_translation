import { describe, it, expect } from 'vitest';
import { commonPathPrefix, displayPathTail } from '../pathDisplay';

/* ================================================================== */
/*  commonPathPrefix                                                     */
/* ================================================================== */

describe('commonPathPrefix', () => {
  it('returns empty string for empty array', () => {
    expect(commonPathPrefix([])).toBe('');
  });

  it('returns parent directory for a single path', () => {
    expect(commonPathPrefix(['/a/b/c/file.yml'])).toBe('/a/b/c');
  });

  it('finds common prefix for unix paths', () => {
    const paths = [
      '/Users/user/project/localisation/english/file1_l_english.yml',
      '/Users/user/project/localisation/french/file1_l_french.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('/Users/user/project/localisation');
  });

  it('returns empty string when no common prefix', () => {
    const paths = [
      '/a/b/c/file1.yml',
      '/x/y/z/file2.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('');
  });

  it('returns empty string for deeply diverging paths', () => {
    const paths = [
      '/aaa/bbb/file1.yml',
      '/aaa/ccc/file2.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('/aaa');
  });

  it('handles paths with spaces', () => {
    const paths = [
      '/Users/user/Library/Application Support/Steam/file1.yml',
      '/Users/user/Library/Application Support/GOG/file2.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('/Users/user/Library/Application Support');
  });

  it('handles mixed directory depths', () => {
    const paths = [
      '/a/b/c/d/e/file1.yml',
      '/a/b/c/file2.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('/a/b/c');
  });

  it('returns full path when paths are identical', () => {
    const paths = [
      '/a/b/c/file.yml',
      '/a/b/c/file.yml',
    ];
    expect(commonPathPrefix(paths)).toBe('/a/b/c/file.yml');
  });

  it('handles rooted paths with single segment', () => {
    expect(commonPathPrefix(['/file.yml'])).toBe('');
  });
});

/* ================================================================== */
/*  displayPathTail                                                     */
/* ================================================================== */

describe('displayPathTail', () => {
  it('shows relative path when common prefix exists', () => {
    const paths = [
      '/a/b/c/file1.yml',
      '/a/b/d/file2.yml',
    ];
    expect(displayPathTail('/a/b/c/file1.yml', paths)).toBe('c/file1.yml');
    expect(displayPathTail('/a/b/d/file2.yml', paths)).toBe('d/file2.yml');
  });

  it('shows last segments when no common prefix', () => {
    const paths = [
      '/x/y/file1.yml',
      '/a/b/file2.yml',
    ];
    expect(displayPathTail('/x/y/file1.yml', paths)).toBe('/x/y/file1.yml');
  });

  it('truncates long tail to last 3 segments', () => {
    const paths = [
      '/a/b/c/d/e/f/file1.yml',
      '/a/b/c/d/e/g/file2.yml',
    ];
    // Common prefix = /a/b/c/d/e, tail = f/file1.yml (2 segments, no truncation needed)
    expect(displayPathTail('/a/b/c/d/e/f/file1.yml', paths)).toBe('f/file1.yml');
  });

  it('handles single path without paths array', () => {
    expect(displayPathTail('/a/b/c/d/e/file.yml')).toBe('…/d/e/file.yml');
  });

  it('keeps short path as-is for single path', () => {
    expect(displayPathTail('/a/b/file.yml')).toBe('/a/b/file.yml');
  });

  it('keeps short path as-is when given paths array of length 1', () => {
    expect(displayPathTail('/a/b/c/file.yml', ['/a/b/c/file.yml'])).toBe('/a/b/c/file.yml');
  });

  it('handles paths with spaces', () => {
    const paths = [
      '/Users/user/My Mod/localisation/english/file.yml',
      '/Users/user/My Mod/localisation/french/file.yml',
    ];
    expect(displayPathTail('/Users/user/My Mod/localisation/english/file.yml', paths))
      .toBe('english/file.yml');
  });

  it('shows useful tail for stellaris-like paths', () => {
    const paths = [
      '/Users/user/Library/Application Support/Steam/workshop/content/281990/3482538734/localisation/english/governments/council_l_english.yml',
      '/Users/user/Library/Application Support/Steam/workshop/content/281990/3482538734/localisation/english/buildings/buildings_l_english.yml',
    ];
    const tail = displayPathTail(paths[0], paths);
    expect(tail).toBe('governments/council_l_english.yml');
    expect(tail.length).toBeLessThan(paths[0].length);
  });

  it('does not modify original path', () => {
    const path = '/a/b/c/file.yml';
    const paths = ['/a/b/c/file.yml', '/a/b/d/file2.yml'];
    displayPathTail(path, paths);
    expect(path).toBe('/a/b/c/file.yml');
  });
});
