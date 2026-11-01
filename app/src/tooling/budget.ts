// The initial-JavaScript budget (SCOPE.md §5.6: "initial JS ≤ 150 KB gzip"). This file is the logic only; it never
// touches the disk. scripts/check-budget.mjs reads `dist/` and passes in two functions, which is what lets the tests
// run on small in-memory builds.
//
// "Initial" means what the browser must download before the first screen can run: the entry script named in
// index.html, everything it imports statically (directly or through other chunks), and anything index.html asks the
// browser to preload. Chunks reached only through `import()` (the lazy Mirage data, the unused FSRS parameter sets) are
// not initial and are deliberately not counted.
//
// Sizes: a "KB" is 1000 bytes, the unit `vite build` prints (and the stricter reading of "150 KB"). The runner gzips
// with Node's zlib at its default level. That is not byte-for-byte the figure `vite build` prints: on one build the
// entry measured 78.55 KB here and 79.32 KB in the build output (about 1%; the cause was not traced). Real servers differ
// again, so read the number as good to a couple of percent, which is enough to catch a 10 KB mistake.

import { lexJs, stringValue, type Token } from './js-lex';

export const INITIAL_JS_BUDGET_BYTES = 150_000;

export interface HtmlAssets {
  /** `src` of every `<script src>`. */
  scripts: string[];
  /** Bodies of inline scripts that are JavaScript (they count toward the budget too). */
  inline: string[];
  /** `href` of every `<link rel="modulepreload">`. */
  preloads: string[];
  /** `href` of every `<link rel="stylesheet">`. */
  styles: string[];
}

const attributes = (tag: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = (m[1] as string).toLowerCase();
    if (!found.has(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return found;
};

/** What index.html asks the browser to load. HTML comments are ignored, so a commented-out script is not counted. */
export function findHtmlAssets(html: string): HtmlAssets {
  const text = html.replace(/<!--[\s\S]*?-->/g, '');
  const out: HtmlAssets = { scripts: [], inline: [], preloads: [], styles: [] };

  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(m[1] as string);
    const src = attrs.get('src');
    if (src !== undefined) {
      out.scripts.push(src);
      continue;
    }
    // JSON data blocks and import maps are not JavaScript. Anything else with a body is.
    const type = (attrs.get('type') ?? '').toLowerCase();
    const body = m[2] as string;
    if (body.trim() && (type === '' || type === 'module' || type === 'text/javascript')) out.inline.push(body);
  }

  for (const m of text.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = attributes(m[1] as string);
    const href = attrs.get('href');
    if (href === undefined) continue;
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('modulepreload')) out.preloads.push(href);
    else if (rel.includes('stylesheet')) out.styles.push(href);
  }
  return out;
}

/** True for a URL on another origin (`https://x`, `//x`, `data:`); such a file cannot be measured from `dist/`. */
const isRemote = (url: string): boolean => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

/** The path of `url` inside `dist/` (for example `assets/index-abc.js`), or null if it is on another origin. */
export function distPath(url: string, importer = ''): string | null {
  const bare = url.replace(/[?#].*$/, '');
  if (isRemote(bare)) return null;
  if (bare.startsWith('/')) return normalise(bare);
  if (bare.startsWith('./') || bare.startsWith('../')) {
    const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/') + 1) : '';
    return normalise(dir + bare);
  }
  // From index.html a plain `assets/x.js` is relative to the page, which sits at the root of dist/.
  return importer === '' ? normalise(bare) : null;
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Module specifiers that `js` loads at start-up: `import x from "a"`, `import "a"`, `export {x} from "a"` and
 * `export * from "a"`. `import("a")` and `import.meta` are not static and are skipped. Strings and comments that
 * happen to contain those words are ignored by the tokeniser.
 */
export function findStaticImports(js: string): string[] {
  const { tokens } = lexJs(js);
  const found: string[] = [];
  const isWord = (k: number, word: string): boolean => tokens[k]?.kind === 'ident' && tokens[k]?.text === word;
  const isPunct = (k: number, mark: string): boolean => tokens[k]?.kind === 'punct' && tokens[k]?.text === mark;

  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k] as Token;
    if (t.kind !== 'ident' || t.depth !== 0 || isPunct(k - 1, '.')) continue;

    if (t.text === 'import') {
      const next = tokens[k + 1];
      if (!next || isPunct(k + 1, '(') || isPunct(k + 1, '.')) continue; // import(...) and import.meta
      if (next.kind === 'string') { found.push(stringValue(next)); continue; } // import "a"
      for (let j = k + 1; j < tokens.length; j += 1) { // import <clause> from "a"
        if (isPunct(j, ';') || isWord(j, 'import')) break;
        const spec = tokens[j + 1];
        if (isWord(j, 'from') && spec?.kind === 'string') { found.push(stringValue(spec)); break; }
      }
    } else if (t.text === 'export' && (isPunct(k + 1, '{') || isPunct(k + 1, '*'))) {
      // export {a as b} from "x"   export * from "x"   export * as ns from "x"
      let j = k + 1;
      if (isPunct(j, '{')) while (j < tokens.length && !isPunct(j, '}')) j += 1;
      else if (isWord(j + 1, 'as')) j += 2;
      if (isWord(j + 1, 'from') && tokens[j + 2]?.kind === 'string') found.push(stringValue(tokens[j + 2] as Token));
    }
  }
  return found;
}

export interface InitialLoad {
  /** Scripts named by index.html, in page order. */
  entries: string[];
  /** Other JavaScript the entries need at start-up: static imports and preloads, in the order they were found. */
  chunks: string[];
  /** Inline script bodies. */
  inline: string[];
  /** Stylesheets linked from index.html. */
  styles: string[];
  /** Things that stop the measurement being trustworthy (missing file, remote script, no entry). */
  problems: string[];
}

/** Everything the page needs to start, found by following imports from index.html. `read` returns a file's text. */
export function collectInitialLoad(html: string, read: (path: string) => string | undefined): InitialLoad {
  const assets = findHtmlAssets(html);
  const load: InitialLoad = { entries: [], chunks: [], inline: assets.inline, styles: [], problems: [] };
  const seen = new Set<string>();

  const resolve = (url: string, importer: string, what: string): string | null => {
    const path = distPath(url, importer);
    if (path === null) load.problems.push(`${what} ${url}${importer ? ` (imported by ${importer})` : ''} is not a file in dist/, so its size is unknown`);
    return path;
  };

  const visit = (path: string, isEntry: boolean): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = read(path);
    if (text === undefined) {
      load.problems.push(`${path} is needed at start-up but is not in dist/`);
      return;
    }
    (isEntry ? load.entries : load.chunks).push(path);
    for (const spec of findStaticImports(text)) {
      const next = resolve(spec, path, 'import');
      if (next !== null) visit(next, false);
    }
  };

  for (const src of assets.scripts) {
    const path = resolve(src, '', 'script');
    if (path !== null) visit(path, true);
  }
  for (const href of assets.preloads) {
    const path = resolve(href, '', 'preload');
    if (path !== null) visit(path, false);
  }
  for (const href of assets.styles) {
    const path = resolve(href, '', 'stylesheet');
    if (path === null) continue;
    if (read(path) === undefined) load.problems.push(`${path} is linked from index.html but is not in dist/`);
    else if (!load.styles.includes(path)) load.styles.push(path);
  }
  if (load.entries.length === 0 && load.inline.length === 0 && load.problems.length === 0) {
    load.problems.push('index.html has no <script src>, so there is no entry to measure');
  }
  return load;
}

export interface BudgetRow {
  kind: 'entry' | 'chunk' | 'inline' | 'css';
  label: string;
  /** Gzipped size in bytes. */
  gzip: number;
}

export interface BudgetReport {
  rows: BudgetRow[];
  /** Gzipped JavaScript that counts against the budget. */
  jsGzip: number;
  /** Gzipped CSS: shown, not budgeted (SCOPE.md §5.6 limits JavaScript). */
  cssGzip: number;
  limit: number;
  problems: string[];
  /** Within budget and nothing prevented a proper measurement. */
  ok: boolean;
}

export interface BuildReader {
  /** The text of a file in dist/, or undefined if it does not exist. */
  read: (path: string) => string | undefined;
  /** Size in bytes of `text` after gzip. */
  gzipBytes: (text: string) => number;
}

/** Measure the initial load described by `html` against `limit` (bytes of gzipped JavaScript). */
export function measureInitialLoad(html: string, io: BuildReader, limit = INITIAL_JS_BUDGET_BYTES): BudgetReport {
  const load = collectInitialLoad(html, io.read);
  const size = (path: string): number => io.gzipBytes(io.read(path) ?? '');
  const rows: BudgetRow[] = [
    ...load.entries.map((path): BudgetRow => ({ kind: 'entry', label: path, gzip: size(path) })),
    ...load.chunks.map((path): BudgetRow => ({ kind: 'chunk', label: path, gzip: size(path) })),
    ...load.inline.map((body, k): BudgetRow => ({ kind: 'inline', label: `inline script ${k + 1}`, gzip: io.gzipBytes(body) })),
    ...load.styles.map((path): BudgetRow => ({ kind: 'css', label: path, gzip: size(path) })),
  ];
  const sum = (kinds: BudgetRow['kind'][]): number => rows.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.gzip, 0);
  const jsGzip = sum(['entry', 'chunk', 'inline']);
  return { rows, jsGzip, cssGzip: sum(['css']), limit, problems: load.problems, ok: load.problems.length === 0 && jsGzip <= limit };
}

const kb = (bytes: number): string => `${(bytes / 1000).toFixed(2)} KB`;

/** The table `pnpm check:budget` prints. */
export function formatReport(report: BudgetReport): string {
  const width = Math.max('javascript'.length, ...report.rows.map((r) => r.label.length));
  const line = (kind: string, label: string, bytes: number, note = ''): string =>
    `  ${kind.padEnd(6)}  ${label.padEnd(width)}  ${kb(bytes).padStart(10)}${note}`;

  const out = [`initial load, gzipped (javascript budget ${kb(report.limit)})`, ''];
  for (const r of report.rows.filter((r) => r.kind !== 'css')) out.push(line(r.kind, r.label, r.gzip));
  for (const r of report.rows.filter((r) => r.kind === 'css')) out.push(line(r.kind, r.label, r.gzip, '  (not in the budget)'));
  out.push('');

  const percent = Math.round((report.jsGzip / report.limit) * 100);
  const verdict = report.jsGzip <= report.limit ? 'ok' : `OVER by ${kb(report.jsGzip - report.limit)}`;
  out.push(line('total', 'javascript', report.jsGzip, `  ${percent}% of budget, ${verdict}`));
  for (const p of report.problems) out.push('', `problem: ${p}`);
  return out.join('\n');
}
