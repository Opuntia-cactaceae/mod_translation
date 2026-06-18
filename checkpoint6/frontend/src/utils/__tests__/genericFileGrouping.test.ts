import { describe, it, expect } from 'vitest';
import {
  deduplicatePaths,
  getRelativePath,
  groupByDirectory,
  groupByFilename,
  groupByLanguageMarker,
  smartGroup,
  detectLanguageMarker,
  stripLanguageSuffix,
  getBasenameFamily,
  groupByDirectoryNode,
  groupByFilenameNode,
  groupByLanguageMarkerNode,
  smartGroupNode,
} from '../genericFileGrouping';

const ROOT = '/games/other';

/* ================================================================== */
/*  deduplicatePaths                                                   */
/* ================================================================== */

describe('deduplicatePaths', () => {
  it('deduplicates paths preserving first-seen order', () => {
    const input = ['/a/b.txt', '/a/c.txt', '/a/b.txt', '/a/d.txt', '/a/c.txt'];
    expect(deduplicatePaths(input)).toEqual(['/a/b.txt', '/a/c.txt', '/a/d.txt']);
  });

  it('treats paths differing only by slashes as duplicates', () => {
    const input = ['/a//b.txt', '/a/b.txt', '/a/b.txt'];
    expect(deduplicatePaths(input)).toHaveLength(1);
  });

  it('treats paths with Windows backslashes as duplicates', () => {
    const input = ['/a/b.txt', '\\a\\b.txt'];
    expect(deduplicatePaths(input)).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicatePaths([])).toEqual([]);
  });

  it('returns same array for unique paths', () => {
    const input = ['/a/1.txt', '/a/2.txt', '/b/3.txt'];
    expect(deduplicatePaths(input)).toEqual(input);
  });
});

/* ================================================================== */
/*  getRelativePath                                                    */
/* ================================================================== */

describe('getRelativePath', () => {
  it('strips root prefix with proper path boundary', () => {
    expect(getRelativePath('/home/games/mod/a.yml', '/home/games')).toBe('mod/a.yml');
  });

  it('does not strip sibling directories with shared prefix', () => {
    expect(getRelativePath('/home/games-other/mod/a.yml', '/home/games')).toBe('/home/games-other/mod/a.yml');
  });

  it('returns empty string when file path equals root', () => {
    expect(getRelativePath('/home/games', '/home/games')).toBe('');
  });

  it('returns full path when file is outside root', () => {
    expect(getRelativePath('/other/path/file.txt', '/home/games')).toBe('/other/path/file.txt');
  });

  it('handles root with trailing slash', () => {
    expect(getRelativePath('/home/games/mod/a.yml', '/home/games/')).toBe('mod/a.yml');
  });
});

/* ================================================================== */
/*  detectLanguageMarker                                               */
/* ================================================================== */

describe('detectLanguageMarker', () => {
  it('returns null for a filename with no language marker', () => {
    expect(detectLanguageMarker('readme.txt')).toBeNull();
    expect(detectLanguageMarker('settings.json')).toBeNull();
    expect(detectLanguageMarker('main.py')).toBeNull();
  });

  it('detects Stellaris-style _l_english marker', () => {
    expect(detectLanguageMarker('wsg_affection_l_english.yml')).toBe('english');
    expect(detectLanguageMarker('wsg_boss_l_russian.yml')).toBe('russian');
    expect(detectLanguageMarker('file_l_simp_chinese.yml')).toBe('simp_chinese');
  });

  it('detects ISO suffix language marker (_en, _ru)', () => {
    expect(detectLanguageMarker('strings_en.json')).toBe('en');
    expect(detectLanguageMarker('strings_ru.json')).toBe('ru');
    expect(detectLanguageMarker('localisation_de.yml')).toBe('de');
  });

  it('detects ISO prefix language marker (en_, ru_)', () => {
    expect(detectLanguageMarker('en_settings.yml')).toBe('en');
    expect(detectLanguageMarker('ru_dialog.txt')).toBe('ru');
    expect(detectLanguageMarker('fr_strings.json')).toBe('fr');
  });

  it('does not detect unknown tokens', () => {
    expect(detectLanguageMarker('foo_bar_baz.yml')).toBeNull();
    expect(detectLanguageMarker('xy_settings.json')).toBeNull();
  });

  it('is case-insensitive for Stellaris-style markers', () => {
    expect(detectLanguageMarker('file_l_ENGLISH.yml')).toBe('english');
    expect(detectLanguageMarker('file_l_Russian.yml')).toBe('russian');
    expect(detectLanguageMarker('file_l_English.yml')).toBe('english');
  });

  it('is case-insensitive for ISO suffix markers', () => {
    expect(detectLanguageMarker('strings_EN.json')).toBe('en');
    expect(detectLanguageMarker('strings_RU.yml')).toBe('ru');
  });

  it('supports compound regional suffixes (pt_br, en_us, zh_cn)', () => {
    expect(detectLanguageMarker('strings_pt_br.json')).toBe('pt');
    expect(detectLanguageMarker('strings_en_us.yml')).toBe('en');
    expect(detectLanguageMarker('strings_zh_cn.yml')).toBe('zh');
  });

  it('supports bare language filenames (en.json, de.yml, ru.txt)', () => {
    expect(detectLanguageMarker('en.json')).toBe('en');
    expect(detectLanguageMarker('de.yml')).toBe('de');
    expect(detectLanguageMarker('ru.txt')).toBe('ru');
    expect(detectLanguageMarker('fr.json')).toBe('fr');
  });

  it('reduces false positives for very short prefix + _xx suffix', () => {
    expect(detectLanguageMarker('a_en.txt')).toBeNull();
    expect(detectLanguageMarker('x_ru.txt')).toBeNull();
  });

  it('allows ISO suffix detection with meaningful prefix length', () => {
    expect(detectLanguageMarker('ab_en.txt')).toBe('en');
    expect(detectLanguageMarker('str_ru.yml')).toBe('ru');
  });
});

/* ================================================================== */
/*  stripLanguageSuffix                                                */
/* ================================================================== */

describe('stripLanguageSuffix', () => {
  it('strips Stellaris-style _l_english suffix', () => {
    expect(stripLanguageSuffix('wsg_affection_l_english')).toBe('wsg_affection');
    expect(stripLanguageSuffix('wsg_boss_l_russian')).toBe('wsg_boss');
  });

  it('strips ISO suffix _en, _ru', () => {
    expect(stripLanguageSuffix('strings_en')).toBe('strings');
    expect(stripLanguageSuffix('config_de')).toBe('config');
  });

  it('returns unchanged when no suffix is found', () => {
    expect(stripLanguageSuffix('wsg_affection')).toBe('wsg_affection');
    expect(stripLanguageSuffix('readme')).toBe('readme');
    expect(stripLanguageSuffix('main_file')).toBe('main_file');
  });
});

/* ================================================================== */
/*  getBasenameFamily                                                  */
/* ================================================================== */

describe('getBasenameFamily', () => {
  it('returns first 2 underscore-delimited parts', () => {
    expect(getBasenameFamily('wsg_affection_l_english.yml')).toBe('wsg_affection');
    expect(getBasenameFamily('wsg_boss_l_english.yml')).toBe('wsg_boss');
    expect(getBasenameFamily('wsg_common_l_english.yml')).toBe('wsg_common');
  });

  it('handles single-part names', () => {
    expect(getBasenameFamily('README.md')).toBe('README');
    expect(getBasenameFamily('config.json')).toBe('config');
  });

  it('returns whole stem for short names', () => {
    expect(getBasenameFamily('data.yml')).toBe('data');
  });
});

/* ================================================================== */
/*  groupByDirectory                                                   */
/* ================================================================== */

describe('groupByDirectory', () => {
  it('groups files by relative directory', () => {
    const files = [
      '/games/other/localisation/english/wsg_affection.yml',
      '/games/other/localisation/english/wsg_boss.yml',
      '/games/other/localisation/french/wsg_affection.yml',
      '/games/other/readme.txt',
    ];
    const groups = groupByDirectory(files, ROOT);
    expect(groups).toHaveLength(3);

    const rootGroup = groups.find(g => g.id === 'dir:');
    expect(rootGroup).toBeDefined();
    expect(rootGroup!.files).toHaveLength(1);

    const engGroup = groups.find(g => g.id === 'dir:localisation/english');
    expect(engGroup).toBeDefined();
    expect(engGroup!.files).toHaveLength(2);

    const frGroup = groups.find(g => g.id === 'dir:localisation/french');
    expect(frGroup).toBeDefined();
    expect(frGroup!.files).toHaveLength(1);
  });

  it('returns empty array for empty file list', () => {
    expect(groupByDirectory([], ROOT)).toHaveLength(0);
  });

  it('returns single group for single file', () => {
    const files = ['/games/other/file.txt'];
    const groups = groupByDirectory(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('dir:');
    expect(groups[0].fileCount).toBe(1);
  });

  it('sorts root group first, then alphabetically', () => {
    const files = [
      '/games/other/beta/file.txt',
      '/games/other/alpha/file.txt',
      '/games/other/root.txt',
    ];
    const groups = groupByDirectory(files, ROOT);
    expect(groups[0].id).toBe('dir:');
    expect(groups[1].id).toBe('dir:alpha');
    expect(groups[2].id).toBe('dir:beta');
  });

  it('deduplicates duplicate input paths', () => {
    const files = [
      '/games/other/localisation/file.txt',
      '/games/other/localisation/file.txt',
    ];
    const groups = groupByDirectory(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('repeated calls with same input produce identical output', () => {
    const files = [
      '/games/other/a/file.txt',
      '/games/other/b/file.txt',
      '/games/other/root.txt',
    ];
    const r1 = groupByDirectory(files, ROOT);
    const r2 = groupByDirectory(files, ROOT);
    expect(r1).toEqual(r2);
  });
});

/* ================================================================== */
/*  groupByFilename                                                    */
/* ================================================================== */

describe('groupByFilename', () => {
  it('groups files with same basename across directories', () => {
    const files = [
      '/games/other/localisation/en/settings.json',
      '/games/other/localisation/fr/settings.json',
      '/games/other/readme.txt',
    ];
    const groups = groupByFilename(files, ROOT);
    expect(groups).toHaveLength(2);

    const settings = groups.find(g => g.id === 'name:settings.json');
    expect(settings).toBeDefined();
    expect(settings!.files).toHaveLength(2);

    const readme = groups.find(g => g.id === 'name:readme.txt');
    expect(readme).toBeDefined();
    expect(readme!.files).toHaveLength(1);
  });

  it('returns empty array for empty file list', () => {
    expect(groupByFilename([], ROOT)).toHaveLength(0);
  });

  it('returns correct count for single files', () => {
    const files = ['/games/other/unique.txt'];
    const groups = groupByFilename(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('deduplicates duplicate input paths', () => {
    const files = [
      '/games/other/file.txt',
      '/games/other/file.txt',
    ];
    const groups = groupByFilename(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('repeated calls with same input produce identical output', () => {
    const files = [
      '/games/other/a/settings.json',
      '/games/other/b/settings.json',
    ];
    const r1 = groupByFilename(files, ROOT);
    const r2 = groupByFilename(files, ROOT);
    expect(r1).toEqual(r2);
  });
});

/* ================================================================== */
/*  groupByLanguageMarker                                              */
/* ================================================================== */

describe('groupByLanguageMarker', () => {
  it('groups Stellaris-style files by language', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/localisation/wsg_boss_l_english.yml',
      '/games/other/localisation/wsg_affection_l_russian.yml',
    ];
    const groups = groupByLanguageMarker(files, ROOT);
    expect(groups).toHaveLength(2);

    const english = groups.find(g => g.id === 'lang:english');
    expect(english).toBeDefined();
    expect(english!.files).toHaveLength(2);

    const russian = groups.find(g => g.id === 'lang:russian');
    expect(russian).toBeDefined();
    expect(russian!.files).toHaveLength(1);
  });

  it('groups ISO-suffix files by language', () => {
    const files = [
      '/games/other/strings_en.json',
      '/games/other/strings_ru.json',
      '/games/other/strings_de.json',
    ];
    const groups = groupByLanguageMarker(files, ROOT);
    expect(groups).toHaveLength(3);
    expect(groups.find(g => g.id === 'lang:en')).toBeDefined();
    expect(groups.find(g => g.id === 'lang:ru')).toBeDefined();
    expect(groups.find(g => g.id === 'lang:de')).toBeDefined();
  });

  it('puts files without marker into unknown group', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/readme.txt',
    ];
    const groups = groupByLanguageMarker(files, ROOT);
    expect(groups).toHaveLength(2);

    const unknown = groups.find(g => g.id === 'lang:unknown');
    expect(unknown).toBeDefined();
    expect(unknown!.files).toHaveLength(1);
    expect(unknown!.label).toBe('Unknown language');
  });

  it('returns empty array for empty file list', () => {
    expect(groupByLanguageMarker([], ROOT)).toHaveLength(0);
  });

  it('sorts unknown group last', () => {
    const files = [
      '/games/other/file_ru.txt',
      '/games/other/file_en.txt',
      '/games/other/no_lang.txt',
    ];
    const groups = groupByLanguageMarker(files, ROOT);
    const lastGroup = groups[groups.length - 1];
    expect(lastGroup.id).toBe('lang:unknown');
  });

  it('deduplicates duplicate input paths', () => {
    const files = [
      '/games/other/strings_en.json',
      '/games/other/strings_en.json',
    ];
    const groups = groupByLanguageMarker(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('repeated calls with same input produce identical output', () => {
    const files = [
      '/games/other/wsg_affection_l_english.yml',
      '/games/other/wsg_boss_l_english.yml',
    ];
    const r1 = groupByLanguageMarker(files, ROOT);
    const r2 = groupByLanguageMarker(files, ROOT);
    expect(r1).toEqual(r2);
  });
});

/* ================================================================== */
/*  smartGroup                                                         */
/* ================================================================== */

describe('smartGroup', () => {
  it('groups files in same directory by prefix family', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/localisation/wsg_affection_trait_l_english.yml',
      '/games/other/localisation/wsg_boss_l_english.yml',
    ];
    const groups = smartGroup(files, ROOT);
    // Two families: wsg_affection, wsg_boss
    expect(groups).toHaveLength(2);

    const affection = groups.find(g => g.id === 'smart:localisation:wsg_affection');
    expect(affection).toBeDefined();
    expect(affection!.files).toHaveLength(2);
    expect(affection!.label).toContain('wsg_affection_*');

    const boss = groups.find(g => g.id === 'smart:localisation:wsg_boss');
    expect(boss).toBeDefined();
    expect(boss!.files).toHaveLength(1);
  });

  it('does not mix files from different directories', () => {
    const files = [
      '/games/other/dir1/data_l_english.yml',
      '/games/other/dir1/info_l_english.yml',
      '/games/other/dir2/data_l_english.yml',
    ];
    const groups = smartGroup(files, ROOT);
    // Three groups: dir1/data, dir1/info, dir2/data
    expect(groups).toHaveLength(3);
  });

  it('handles files with no common prefix', () => {
    const files = [
      '/games/other/alpha.yml',
      '/games/other/beta.yml',
    ];
    const groups = smartGroup(files, ROOT);
    expect(groups).toHaveLength(2);
  });

  it('returns empty array for empty file list', () => {
    expect(smartGroup([], ROOT)).toHaveLength(0);
  });

  it('returns single group for single file', () => {
    const files = ['/games/other/single_file.yml'];
    const groups = smartGroup(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('sorts groups alphabetically within directory', () => {
    const files = [
      '/games/other/localisation/wsg_zulu_l_english.yml',
      '/games/other/localisation/wsg_alpha_l_english.yml',
      '/games/other/localisation/wsg_beta_l_english.yml',
    ];
    const groups = smartGroup(files, ROOT);
    expect(groups).toHaveLength(3);
    expect(groups[0].label).toContain('wsg_alpha');
    expect(groups[1].label).toContain('wsg_beta');
    expect(groups[2].label).toContain('wsg_zulu');
  });

  it('strips language suffixes before computing prefix', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/localisation/wsg_affection_trait_l_russian.yml',
    ];
    const groups = smartGroup(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toContain('wsg_affection_*');
    expect(groups[0].files).toHaveLength(2);
  });

  it('deduplicates duplicate input paths', () => {
    const files = [
      '/games/other/localisation/wsg_test_l_english.yml',
      '/games/other/localisation/wsg_test_l_english.yml',
    ];
    const groups = smartGroup(files, ROOT);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileCount).toBe(1);
  });

  it('repeated calls with same input produce identical output', () => {
    const files = [
      '/games/other/localisation/wsg_alpha_l_english.yml',
      '/games/other/localisation/wsg_beta_l_english.yml',
    ];
    const r1 = smartGroup(files, ROOT);
    const r2 = smartGroup(files, ROOT);
    expect(r1).toEqual(r2);
  });
});

/* ================================================================== */
/*  groupByDirectoryNode — directory-tree grouping (folder mode)        */
/* ================================================================== */

describe('groupByDirectoryNode', () => {
  it('builds a recursive directory tree preserving hierarchy', () => {
    const files = [
      '/games/other/1121692237/localisation/braz_por/a.yml',
      '/games/other/1121692237/localisation/braz_por/b.yml',
      '/games/other/1121692237/localisation/braz_por/random_names/a.yml',
      '/games/other/1121692237/localisation/eng/a.yml',
    ];
    const tree = groupByDirectoryNode(files, ROOT);

    // Top-level should have one node: 1121692237
    expect(tree).toHaveLength(1);
    const n1 = tree[0];
    expect(n1.id).toBe('dir:1121692237');
    expect(n1.label).toBe('1121692237');
    expect(n1.fileCount).toBe(4);
    expect(n1.files).toHaveLength(4);
    expect(n1.children).toBeDefined();
    expect(n1.children).toHaveLength(1);

    // 1121692237/localisation
    const localisation = n1.children![0];
    expect(localisation.id).toBe('dir:1121692237/localisation');
    expect(localisation.label).toBe('localisation');
    expect(localisation.fileCount).toBe(4);
    expect(localisation.children).toBeDefined();
    expect(localisation.children).toHaveLength(2);

    // braz_por node
    const brazPor = localisation.children!.find(c => c.id === 'dir:1121692237/localisation/braz_por');
    expect(brazPor).toBeDefined();
    expect(brazPor!.label).toBe('braz_por');
    expect(brazPor!.fileCount).toBe(3);
    // 3 children: 2 file nodes (a.yml, b.yml) + 1 subdir (random_names)
    expect(brazPor!.children).toBeDefined();
    expect(brazPor!.children).toHaveLength(3);
    // Has both direct files and subdir files in its files array
    expect(brazPor!.files).toHaveLength(3);

    // random_names is a child of braz_por, NOT a sibling
    const randomNames = brazPor!.children!.find(c => c.id === 'dir:1121692237/localisation/braz_por/random_names');
    expect(randomNames).toBeDefined();
    expect(randomNames!.label).toBe('random_names');
    expect(randomNames!.fileCount).toBe(1);
    expect(randomNames!.children).toHaveLength(1);
    // the single file under random_names
    const randomFile = randomNames!.children![0];
    expect(randomFile.label).toBe('a.yml');
    expect(randomFile.fileCount).toBe(1);

    // eng node (sibling of braz_por)
    const eng = localisation.children!.find(c => c.id === 'dir:1121692237/localisation/eng');
    expect(eng).toBeDefined();
    expect(eng!.label).toBe('eng');
    expect(eng!.fileCount).toBe(1);
    expect(eng!.children).toHaveLength(1);
  });

  it('returns empty array for empty file list', () => {
    expect(groupByDirectoryNode([], ROOT)).toHaveLength(0);
  });

  it('returns single top-level node for files in root directory', () => {
    const files = ['/games/other/file.txt'];
    const tree = groupByDirectoryNode(files, ROOT);
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('file.txt');
    expect(tree[0].fileCount).toBe(1);
    expect(tree[0].files).toEqual(files);
  });

  it('groups root-level files and subdirectories as siblings', () => {
    const files = [
      '/games/other/readme.txt',
      '/games/other/subdir/data.yml',
    ];
    const tree = groupByDirectoryNode(files, ROOT);
    // Two top-level items: readme.txt file node + subdir directory node
    expect(tree).toHaveLength(2);
    const readme = tree.find(n => n.label === 'readme.txt');
    expect(readme).toBeDefined();
    expect(readme!.fileCount).toBe(1);
    const subdir = tree.find(n => n.label === 'subdir');
    expect(subdir).toBeDefined();
    expect(subdir!.fileCount).toBe(1);
  });

  it('deduplicates duplicate paths', () => {
    const files = [
      '/games/other/subdir/file.txt',
      '/games/other/subdir/file.txt',
    ];
    const tree = groupByDirectoryNode(files, ROOT);
    expect(tree).toHaveLength(1);
    expect(tree[0].fileCount).toBe(1);
    expect(tree[0].files).toHaveLength(1);
  });

  it('repeated calls with same input produce identical output', () => {
    const files = [
      '/games/other/a/file.txt',
      '/games/other/b/file.txt',
    ];
    const r1 = groupByDirectoryNode(files, ROOT);
    const r2 = groupByDirectoryNode(files, ROOT);
    expect(r1).toEqual(r2);
  });

  it('does not create duplicate directory nodes for the same path', () => {
    const files = [
      '/games/other/localisation/braz_por/a.yml',
      '/games/other/localisation/braz_por/b.yml',
      '/games/other/localisation/braz_por/random_names/a.yml',
    ];
    const tree = groupByDirectoryNode(files, ROOT);
    expect(tree).toHaveLength(1);

    // Collect all dir IDs via depth-first traversal
    const dirIds = new Set<string>();
    function walk(nodes: typeof tree) {
      for (const n of nodes) {
        if (n.id.startsWith('dir:')) {
          expect(dirIds.has(n.id)).toBe(false); // no duplicate
          dirIds.add(n.id);
        }
        if (n.children) walk(n.children);
      }
    }
    walk(tree);
    expect(dirIds.size).toBe(3); // localisation, braz_por, random_names
  });
});

/* ================================================================== */
/*  groupByFilenameNode — directory-aware filename grouping             */
/* ================================================================== */

describe('groupByFilenameNode', () => {
  it('groups files by basename within each directory, not globally', () => {
    const files = [
      '/games/other/1121692237/localisation/braz_por/a.yml',
      '/games/other/1121692237/localisation/braz_por/b.yml',
      '/games/other/1121692237/localisation/braz_por/random_names/a.yml',
      '/games/other/1121692237/localisation/eng/a.yml',
    ];
    const tree = groupByFilenameNode(files, ROOT);

    // Navigate to braz_por
    const localisation = tree[0].children![0];
    const brazPor = localisation.children!.find(c => c.label === 'braz_por')!;
    const eng = localisation.children!.find(c => c.label === 'eng')!;

    // In braz_por: files grouped by basename
    // a.yml group has [a.yml] (from braz_por directly)
    // b.yml group has [b.yml]
    // random_names is a subdirectory
    const brazA = brazPor.children!.find(c => c.label === 'a.yml');
    const brazB = brazPor.children!.find(c => c.label === 'b.yml');
    expect(brazA).toBeDefined();
    expect(brazB).toBeDefined();

    // a.yml in braz_por should contain only 1 file (the one from braz_por, NOT eng's a.yml)
    expect(brazA!.files).toHaveLength(1);
    expect(brazA!.files[0]).toContain('braz_por/a.yml');

    // In eng: a.yml group has 1 file
    const engA = eng.children!.find(c => c.label === 'a.yml');
    expect(engA).toBeDefined();
    expect(engA!.files).toHaveLength(1);
    expect(engA!.files[0]).toContain('eng/a.yml');
  });

  it('preserves directory hierarchy', () => {
    const files = [
      '/games/other/1121692237/localisation/braz_por/a.yml',
      '/games/other/1121692237/localisation/eng/a.yml',
    ];
    const tree = groupByFilenameNode(files, ROOT);
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('1121692237');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].label).toBe('localisation');
    expect(tree[0].children![0].children).toHaveLength(2);
    expect(tree[0].children![0].children!.map(c => c.label).sort()).toEqual(['braz_por', 'eng']);
  });

  it('returns empty array for empty file list', () => {
    expect(groupByFilenameNode([], ROOT)).toHaveLength(0);
  });
});

/* ================================================================== */
/*  groupByLanguageMarkerNode — directory-aware language grouping       */
/* ================================================================== */

describe('groupByLanguageMarkerNode', () => {
  it('groups by language within each directory', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/localisation/wsg_boss_l_english.yml',
      '/games/other/localisation/wsg_affection_l_russian.yml',
    ];
    const tree = groupByLanguageMarkerNode(files, ROOT);
    expect(tree).toHaveLength(1);

    const locNode = tree[0]; // localisation
    expect(locNode.label).toBe('localisation');
    // Children: 2 language groups (English, Russian)
    expect(locNode.children).toHaveLength(2);
    const english = locNode.children!.find(c => c.label === 'English');
    expect(english).toBeDefined();
    expect(english!.files).toHaveLength(2);
    const russian = locNode.children!.find(c => c.label === 'Russian');
    expect(russian).toBeDefined();
    expect(russian!.files).toHaveLength(1);
  });

  it('returns empty array for empty file list', () => {
    expect(groupByLanguageMarkerNode([], ROOT)).toHaveLength(0);
  });
});

/* ================================================================== */
/*  smartGroupNode — directory-aware smart grouping                    */
/* ================================================================== */

describe('smartGroupNode', () => {
  it('groups by family prefix within each directory', () => {
    const files = [
      '/games/other/localisation/wsg_affection_l_english.yml',
      '/games/other/localisation/wsg_affection_trait_l_english.yml',
      '/games/other/localisation/wsg_boss_l_english.yml',
    ];
    const tree = smartGroupNode(files, ROOT);
    expect(tree).toHaveLength(1);
    const locNode = tree[0];
    expect(locNode.label).toBe('localisation');
    // Two families: wsg_affection_*, wsg_boss
    expect(locNode.children).toHaveLength(2);
    const affection = locNode.children!.find(c => c.label.includes('wsg_affection'));
    expect(affection).toBeDefined();
    expect(affection!.files).toHaveLength(2);
    const boss = locNode.children!.find(c => c.label.includes('wsg_boss'));
    expect(boss).toBeDefined();
    expect(boss!.files).toHaveLength(1);
  });

  it('does not mix files from different directories', () => {
    const files = [
      '/games/other/dir1/data_l_english.yml',
      '/games/other/dir1/info_l_english.yml',
      '/games/other/dir2/data_l_english.yml',
    ];
    const tree = smartGroupNode(files, ROOT);
    expect(tree).toHaveLength(2); // dir1, dir2
    const dir1 = tree.find(n => n.label === 'dir1')!;
    expect(dir1.children).toHaveLength(2); // data_*, info_*
    const dir2 = tree.find(n => n.label === 'dir2')!;
    expect(dir2.children).toHaveLength(1); // data_*
  });

  it('returns empty array for empty file list', () => {
    expect(smartGroupNode([], ROOT)).toHaveLength(0);
  });
});
