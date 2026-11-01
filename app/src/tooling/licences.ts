// Keeps the dependency table in THIRD-PARTY.md honest (SCOPE.md §9 asks for that file). Logic only; the runner is
// scripts/licences.mjs, which reads the installed packages and the file.
//
// The table sits between two marker comments and is machine-made: versions and licences come from the installed
// packages' own package.json files, so they are never typed by hand. The one column a person writes is "Used for",
// and `--write` keeps what is there. Everything outside the markers is ordinary prose and is never touched.

export type DepGroup = 'dependencies' | 'devDependencies';

/** What the runner read from node_modules for one direct dependency. */
export interface InstalledDep {
  name: string;
  group: DepGroup;
  version: string;
  /** From the package's own package.json; null when it declares none. */
  licence: string | null;
}

export interface Row {
  name: string;
  version: string;
  licence: string;
  use: string;
}

export const BLOCK_START = '<!-- licences:start - made by `node scripts/licences.mjs --write`; edit only the "Used for" column -->';
export const BLOCK_END = '<!-- licences:end -->';
/** Written for a package that has no description yet; `--check` fails until someone replaces it. */
export const TODO_USE = 'TODO: say what this is used for';

const GROUP_TITLES: Record<DepGroup, string> = {
  dependencies: 'Dependencies (`dependencies` in `app/package.json`)',
  devDependencies: 'Development tools (`devDependencies` in `app/package.json`)',
};

/** The licence a package.json declares: the SPDX `license` string, or the older object and `licenses` list forms. */
export function licenceOf(pkg: unknown): string | null {
  if (typeof pkg !== 'object' || pkg === null) return null;
  const { license, licenses } = pkg as { license?: unknown; licenses?: unknown };
  const named = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string') return named((v as { type: string }).type);
    return null;
  };
  const single = named(license);
  if (single) return single;
  if (Array.isArray(licenses)) {
    const all = licenses.map(named).filter((l): l is string => l !== null);
    if (all.length > 0) return all.join(' OR ');
  }
  return null;
}

const splitLines = (text: string): string[] => text.split(/\r?\n/);
const cell = (text: string): string => text.replace(/\|/g, '\\|');
const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** Line numbers of the marker comments, or null if the file has no block (or it is malformed). */
function locate(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.startsWith('<!-- licences:start'));
  const end = lines.findIndex((l, k) => k > start && l.trim() === BLOCK_END);
  return start >= 0 && end > start ? { start, end } : null;
}

/** The rows of the table in `text`, by package name. Empty if there is no block. */
export function parseRows(text: string): Map<string, Row> {
  const lines = splitLines(text);
  const at = locate(lines);
  const rows = new Map<string, Row>();
  if (!at) return rows;
  for (const line of lines.slice(at.start + 1, at.end)) {
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    const name = (c[0] ?? '').replace(/`/g, '');
    if (c.length < 4 || name === 'Package' || /^:?-+:?$/.test(c[0] ?? '')) continue;
    rows.set(name, { name, version: c[1] ?? '', licence: c[2] ?? '', use: c[3] ?? '' });
  }
  return rows;
}

const byName = (a: InstalledDep, b: InstalledDep): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The lines of the block, markers included, for `deps`, taking each "Used for" text from `uses`. */
function renderBlock(deps: InstalledDep[], uses: Map<string, Row>): string[] {
  const out = [BLOCK_START];
  for (const group of ['dependencies', 'devDependencies'] as const) {
    const members = deps.filter((d) => d.group === group).sort(byName);
    if (members.length === 0) continue;
    out.push('', `### ${GROUP_TITLES[group]}`, '', '| Package | Version | Licence | Used for |', '|---|---|---|---|');
    for (const d of members) {
      const use = uses.get(d.name)?.use || TODO_USE;
      out.push(`| \`${d.name}\` | ${cell(d.version)} | ${cell(d.licence ?? 'not declared')} | ${cell(use)} |`);
    }
  }
  out.push('', BLOCK_END);
  return out;
}

/** `text` with the table rebuilt from `deps`. Existing "Used for" texts are kept. Throws if there is no block. */
export function updateTable(text: string, deps: InstalledDep[]): string {
  const lines = splitLines(text);
  const at = locate(lines);
  if (!at) throw new Error(`THIRD-PARTY.md has no table block: add the lines "${BLOCK_START}" and "${BLOCK_END}" where the table should go`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = renderBlock(deps, parseRows(text));
  return [...lines.slice(0, at.start), ...block, ...lines.slice(at.end + 1)].join(eol);
}

/** What is wrong with the table in `text`, as sentences. Empty means it lists every dependency correctly. */
export function checkTable(text: string, deps: InstalledDep[]): string[] {
  if (!locate(splitLines(text))) return [`THIRD-PARTY.md has no table block (${BLOCK_START} ... ${BLOCK_END})`];

  const rows = parseRows(text);
  const problems: string[] = [];
  for (const d of [...deps].sort(byName)) {
    const row = rows.get(d.name);
    if (!row) {
      problems.push(`${d.name} (${d.group}) is not in THIRD-PARTY.md`);
      continue;
    }
    if (d.licence === null) problems.push(`${d.name} declares no licence in its package.json: read its LICENSE file and decide what to record`);
    if (row.version !== d.version) problems.push(`${d.name}: THIRD-PARTY.md says version ${row.version}, ${d.version} is installed`);
    if (d.licence !== null && row.licence !== d.licence) problems.push(`${d.name}: THIRD-PARTY.md says licence ${row.licence}, the installed package says ${d.licence}`);
    if (!row.use || row.use === TODO_USE) problems.push(`${d.name} has no "Used for" text`);
  }
  for (const name of rows.keys()) {
    if (!deps.some((d) => d.name === name)) problems.push(`${name} is in THIRD-PARTY.md but is not a dependency in app/package.json any more`);
  }

  // Same facts, different layout (wrong heading, order, or a hand-edit): the table should be exactly what --write makes.
  if (problems.length === 0) {
    const lines = splitLines(text);
    const at = locate(lines) as { start: number; end: number };
    const have = lines.slice(at.start, at.end + 1).map((l) => l.trimEnd());
    const want = renderBlock(deps, rows);
    if (have.length !== want.length || have.some((l, k) => l !== want[k])) problems.push('the table is not in the form `node scripts/licences.mjs --write` produces');
  }
  return problems;
}
