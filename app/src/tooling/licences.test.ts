import { describe, expect, it } from 'vitest';
import { BLOCK_END, BLOCK_START, TODO_USE, checkTable, licenceOf, parseRows, updateTable, type InstalledDep } from './licences';

const deps: InstalledDep[] = [
  { name: 'zod', group: 'dependencies', version: '4.6.7', licence: 'MIT' },
  { name: '@scope/font', group: 'dependencies', version: '5.3.0', licence: 'OFL-1.1' },
  { name: 'vitest', group: 'devDependencies', version: '5.0.5', licence: 'MIT' },
];

const FILE = (table: string) => `# Third-party material\n\nIntro text that is not a table.\n\n${table}\n\n## Font\n\nProse after the table.\n`;
const EMPTY = FILE(`${BLOCK_START}\n${BLOCK_END}`);

/** A table with a "Used for" text filled in for every package. */
function filled(): string {
  const uses: Record<string, string> = { zod: 'validates data', '@scope/font': 'the font', vitest: 'unit tests' };
  return updateTable(EMPTY, deps)
    .split('\n')
    .map((line) => {
      const name = /^\| `([^`]+)` \|/.exec(line)?.[1];
      return name !== undefined && uses[name] ? line.replace(TODO_USE, uses[name]) : line;
    })
    .join('\n');
}

describe('licenceOf', () => {
  it('reads an SPDX string, trimmed', () => {
    expect(licenceOf({ license: 'MIT' })).toBe('MIT');
    expect(licenceOf({ license: ' (MIT OR Apache-2.0) ' })).toBe('(MIT OR Apache-2.0)');
  });

  it('reads the old object and list forms', () => {
    expect(licenceOf({ license: { type: 'ISC', url: 'x' } })).toBe('ISC');
    expect(licenceOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(licenceOf({ licenses: ['MIT'] })).toBe('MIT');
  });

  it('returns null when nothing usable is declared', () => {
    expect(licenceOf({})).toBeNull();
    expect(licenceOf({ license: '' })).toBeNull();
    expect(licenceOf({ license: 42, licenses: [] })).toBeNull();
    expect(licenceOf(null)).toBeNull();
    expect(licenceOf('MIT')).toBeNull();
  });
});

describe('updateTable', () => {
  it('builds both tables, sorted by name, with a TODO for every new package', () => {
    const text = updateTable(EMPTY, deps);
    expect(text).toContain('### Dependencies (`dependencies` in `app/package.json`)');
    expect(text).toContain('### Development tools (`devDependencies` in `app/package.json`)');
    const names = [...parseRows(text).keys()];
    expect(names).toEqual(['@scope/font', 'zod', 'vitest']);
    expect(parseRows(text).get('zod')).toEqual({ name: 'zod', version: '4.6.7', licence: 'MIT', use: TODO_USE });
  });

  it('leaves the text around the block alone', () => {
    const text = updateTable(EMPTY, deps);
    expect(text.startsWith('# Third-party material\n\nIntro text that is not a table.\n\n')).toBe(true);
    expect(text.endsWith('\n\n## Font\n\nProse after the table.\n')).toBe(true);
  });

  it('keeps what a person wrote, and refreshes version and licence', () => {
    const before = filled().replace('| 4.6.7 | MIT | validates data |', '| 4.0.0 | ISC | validates data |');
    const after = updateTable(before, deps);
    expect(parseRows(after).get('zod')).toEqual({ name: 'zod', version: '4.6.7', licence: 'MIT', use: 'validates data' });
  });

  it('drops a package that is gone and adds one that is new', () => {
    const after = updateTable(filled(), [...deps.filter((d) => d.name !== 'zod'), { name: 'idb', group: 'dependencies', version: '8.0.4', licence: 'ISC' }]);
    expect([...parseRows(after).keys()]).toEqual(['@scope/font', 'idb', 'vitest']);
    expect(parseRows(after).get('idb')?.use).toBe(TODO_USE);
  });

  it('is idempotent', () => {
    const once = filled();
    expect(updateTable(once, deps)).toBe(once);
  });

  it('writes "not declared" for a package without a licence', () => {
    const text = updateTable(EMPTY, [{ name: 'odd', group: 'dependencies', version: '1.0.0', licence: null }]);
    expect(parseRows(text).get('odd')?.licence).toBe('not declared');
  });

  it('survives a pipe in a description', () => {
    const edited = filled().replace('validates data', 'a \\| b');
    expect(parseRows(edited).get('zod')?.use).toBe('a | b');
    expect(parseRows(updateTable(edited, deps)).get('zod')?.use).toBe('a | b');
  });

  it('refuses a file with no block', () => {
    expect(() => updateTable('# nothing here\n', deps)).toThrow(/no table block/);
    expect(() => updateTable(`${BLOCK_START}\nno end marker`, deps)).toThrow(/no table block/);
  });

  it('keeps Windows line endings', () => {
    const crlf = EMPTY.replace(/\n/g, '\r\n');
    const text = updateTable(crlf, deps);
    expect(text).not.toMatch(/[^\r]\n/);
  });
});

describe('checkTable', () => {
  it('passes a table that lists every dependency correctly', () => {
    expect(checkTable(filled(), deps)).toEqual([]);
  });

  it('passes after Windows line endings and trailing spaces creep in', () => {
    expect(checkTable(filled().replace(/\n/g, ' \r\n'), deps)).toEqual([]);
  });

  it('names a dependency that is missing from the file', () => {
    const more = [...deps, { name: 'idb', group: 'dependencies' as const, version: '8.0.4', licence: 'ISC' }];
    expect(checkTable(filled(), more)).toEqual(['idb (dependencies) is not in THIRD-PARTY.md']);
  });

  it('names a dev dependency that is missing from the file', () => {
    const more = [...deps, { name: 'svelte', group: 'devDependencies' as const, version: '5.57.3', licence: 'MIT' }];
    expect(checkTable(filled(), more)).toEqual(['svelte (devDependencies) is not in THIRD-PARTY.md']);
  });

  it('names a row whose package is gone', () => {
    expect(checkTable(filled(), deps.slice(1))).toEqual(['zod is in THIRD-PARTY.md but is not a dependency in app/package.json any more']);
  });

  it('names a version that has moved', () => {
    const bumped = deps.map((d) => (d.name === 'zod' ? { ...d, version: '4.7.0' } : d));
    expect(checkTable(filled(), bumped)).toEqual(['zod: THIRD-PARTY.md says version 4.6.7, 4.7.0 is installed']);
  });

  it('names a licence that has changed', () => {
    const relicensed = deps.map((d) => (d.name === 'vitest' ? { ...d, licence: 'BUSL-1.1' } : d));
    expect(checkTable(filled(), relicensed)).toEqual(['vitest: THIRD-PARTY.md says licence MIT, the installed package says BUSL-1.1']);
  });

  it('fails for a package that declares no licence', () => {
    const odd = deps.map((d) => (d.name === 'zod' ? { ...d, licence: null } : d));
    expect(checkTable(filled(), odd)[0]).toContain('zod declares no licence');
  });

  it('fails while a "Used for" is still the TODO placeholder or empty', () => {
    expect(checkTable(updateTable(EMPTY, deps), deps)).toEqual([
      '@scope/font has no "Used for" text',
      'vitest has no "Used for" text',
      'zod has no "Used for" text',
    ]);
    expect(checkTable(filled().replace('validates data', ''), deps)).toEqual(['zod has no "Used for" text']);
  });

  it('fails when the table was edited into a different layout', () => {
    const moved = filled().replace('### Development tools', '### Tools');
    expect(checkTable(moved, deps)).toEqual(['the table is not in the form `node scripts/licences.mjs --write` produces']);
  });

  it('fails when there is no block', () => {
    expect(checkTable('# empty\n', deps)[0]).toContain('has no table block');
  });
});
