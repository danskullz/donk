import { describe, expect, it } from 'vitest';
import {
  INITIAL_JS_BUDGET_BYTES,
  collectInitialLoad,
  distPath,
  findHtmlAssets,
  findStaticImports,
  formatReport,
  measureInitialLoad,
} from './budget';

// The shape of a real `vite build` result: the entry imports one shared chunk statically, loads others lazily, and
// index.html preloads the shared chunk.
const HTML = `<!doctype html>
<html><head>
<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/shared-BBB.js">
<link rel="stylesheet" crossorigin href="/assets/index-CCC.css">
</head><body><div id="app"></div></body></html>`;

const ENTRY = `import{C as e,D as t}from"./shared-BBB.js";
const lazy=()=>import("./lazy-DDD.js");
const deps=["assets/lazy-DDD.js"];
console.log("import x from './not-a-chunk.js'");`;

/** An in-memory dist/: gzip size is just the text length, so the sums in the tests are easy to follow. */
const build = (files: Record<string, string>) => ({
  read: (path: string) => files[path],
  gzipBytes: (text: string) => text.length,
});

describe('findHtmlAssets', () => {
  it('finds scripts, preloads and stylesheets', () => {
    expect(findHtmlAssets(HTML)).toEqual({
      scripts: ['/assets/index-AAA.js'],
      inline: [],
      preloads: ['/assets/shared-BBB.js'],
      styles: ['/assets/index-CCC.css'],
    });
  });

  it('does not count a commented-out script', () => {
    const html = '<!-- <script src="/old.js"></script> --><script src="/new.js"></script>';
    expect(findHtmlAssets(html).scripts).toEqual(['/new.js']);
  });

  it('accepts single quotes, unquoted values and any attribute order', () => {
    const html = `<link href='/a.css' rel=stylesheet><link rel="preload stylesheet" href=/b.css><script src=/c.js defer></script>`;
    const a = findHtmlAssets(html);
    expect(a.styles).toEqual(['/a.css', '/b.css']);
    expect(a.scripts).toEqual(['/c.js']);
  });

  it('keeps inline JavaScript but not JSON or import maps', () => {
    const html = `<script>boot()</script><script type="importmap">{"imports":{}}</script><script type="application/ld+json">{}</script><script></script>`;
    expect(findHtmlAssets(html).inline).toEqual(['boot()']);
  });

  it('ignores other kinds of link', () => {
    expect(findHtmlAssets('<link rel="manifest" href="/m.json"><link rel="icon" href="/i.svg">').styles).toEqual([]);
  });
});

describe('distPath', () => {
  it('maps page URLs to paths in dist/', () => {
    expect(distPath('/assets/a.js')).toBe('assets/a.js');
    expect(distPath('./assets/a.js?v=1#x')).toBe('assets/a.js');
    expect(distPath('assets/a.js')).toBe('assets/a.js');
  });

  it('resolves imports relative to the importing file', () => {
    expect(distPath('./b.js', 'assets/a.js')).toBe('assets/b.js');
    expect(distPath('../vendor/c.js', 'assets/a.js')).toBe('vendor/c.js');
    expect(distPath('/assets/d.js', 'assets/a.js')).toBe('assets/d.js');
  });

  it('refuses other origins and bare specifiers', () => {
    expect(distPath('https://cdn.example/x.js')).toBeNull();
    expect(distPath('//cdn.example/x.js')).toBeNull();
    expect(distPath('data:text/javascript,1')).toBeNull();
    expect(distPath('lodash', 'assets/a.js')).toBeNull();
  });
});

describe('findStaticImports', () => {
  it('finds each static form, minified or not', () => {
    const js = `
      import a from "./a.js";
      import {b as c, d} from './b.js'
      import * as ns from "./c.js";
      import"./d.js";
      import def,{x} from "./e.js";
      export {y as z} from "./f.js";
      export*from"./g.js";
      export * as h from "./h.js";
    `;
    expect(findStaticImports(js)).toEqual(['./a.js', './b.js', './c.js', './d.js', './e.js', './f.js', './g.js', './h.js']);
  });

  it('skips dynamic import, import.meta, and exports without a source', () => {
    const js = `const m = await import("./lazy.js"); const u = import.meta.url; export {m}; export const k = 1; export default m;`;
    expect(findStaticImports(js)).toEqual([]);
  });

  it('ignores the words inside strings, comments, templates and regular expressions', () => {
    const js = [
      `// import x from "./comment.js"`,
      `/* import "./block.js" */`,
      `const s = 'import x from "./string.js"';`,
      'const t = `import y from "./template.js" ${ import("./dynamic.js") }`;',
      `const r = /import z from "\\.\\/regex.js"/;`,
      `import real from "./real.js";`,
    ].join('\n');
    expect(findStaticImports(js)).toEqual(['./real.js']);
  });

  it('ignores a property or key called import', () => {
    expect(findStaticImports(`x.import("./a.js"); const o = {import: "./b.js"}; y.export * 2;`)).toEqual([]);
  });

  it('stops a malformed import at the next statement instead of reading on', () => {
    expect(findStaticImports(`import a; import b from "./b.js";`)).toEqual(['./b.js']);
  });
});

describe('collectInitialLoad', () => {
  const files = {
    'assets/index-AAA.js': ENTRY,
    'assets/shared-BBB.js': 'export const shared = 1;',
    'assets/lazy-DDD.js': 'export const lazy = 1;',
    'assets/index-CCC.css': 'body{}',
  };

  it('follows static imports and leaves dynamic ones out', () => {
    const load = collectInitialLoad(HTML, (p) => files[p as keyof typeof files]);
    expect(load.entries).toEqual(['assets/index-AAA.js']);
    expect(load.chunks).toEqual(['assets/shared-BBB.js']); // imported and preloaded, but only once
    expect(load.styles).toEqual(['assets/index-CCC.css']);
    expect(load.problems).toEqual([]);
  });

  it('follows imports through several levels, once each, even around a cycle', () => {
    const html = '<script type="module" src="/assets/e.js"></script>';
    const f: Record<string, string> = {
      'assets/e.js': 'import"./a.js";import"./b.js";',
      'assets/a.js': 'import"./c.js";',
      'assets/b.js': 'import"./c.js";',
      'assets/c.js': 'import"./a.js";',
    };
    expect(collectInitialLoad(html, (p) => f[p]).chunks).toEqual(['assets/a.js', 'assets/c.js', 'assets/b.js']);
  });

  it('counts a preloaded chunk that nothing imports statically', () => {
    const html = '<script src="/e.js"></script><link rel="modulepreload" href="/p.js">';
    const f: Record<string, string> = { 'e.js': '1', 'p.js': '2' };
    expect(collectInitialLoad(html, (p) => f[p]).chunks).toEqual(['p.js']);
  });

  it('reports a missing file, a remote script and a page with no entry', () => {
    const missing = collectInitialLoad('<script src="/gone.js"></script>', () => undefined);
    expect(missing.problems).toEqual(['gone.js is needed at start-up but is not in dist/']);

    const remote = collectInitialLoad('<script src="https://cdn.example/x.js"></script>', () => undefined);
    expect(remote.problems[0]).toContain('https://cdn.example/x.js is not a file in dist/');

    const none = collectInitialLoad('<html></html>', () => undefined);
    expect(none.problems).toEqual(['index.html has no <script src>, so there is no entry to measure']);
  });

  it('reports an import whose file is not in dist/', () => {
    const f: Record<string, string> = { 'e.js': 'import"./nope.js";' };
    const load = collectInitialLoad('<script src="/e.js"></script>', (p) => f[p]);
    expect(load.problems).toEqual(['nope.js is needed at start-up but is not in dist/']);
  });
});

describe('measureInitialLoad', () => {
  const files = {
    'assets/index-AAA.js': ENTRY,
    'assets/shared-BBB.js': 'x'.repeat(1000),
    'assets/lazy-DDD.js': 'y'.repeat(100_000), // large, but lazy: must not count
    'assets/index-CCC.css': 'c'.repeat(300),
  };

  it('sums the entry and its static chunks, and shows CSS without budgeting it', () => {
    const r = measureInitialLoad(HTML, build(files), 5000);
    expect(r.rows.map((x) => [x.kind, x.label, x.gzip])).toEqual([
      ['entry', 'assets/index-AAA.js', ENTRY.length],
      ['chunk', 'assets/shared-BBB.js', 1000],
      ['css', 'assets/index-CCC.css', 300],
    ]);
    expect(r.jsGzip).toBe(ENTRY.length + 1000);
    expect(r.cssGzip).toBe(300);
    expect(r.ok).toBe(true);
  });

  it('counts inline scripts toward the budget', () => {
    const r = measureInitialLoad('<script src="/e.js"></script><script>1234567890</script>', build({ 'e.js': 'ab' }), 100);
    expect(r.rows.map((x) => x.kind)).toEqual(['entry', 'inline']);
    expect(r.jsGzip).toBe(12);
  });

  it('passes exactly at the limit and fails one byte over', () => {
    const size = ENTRY.length + 1000;
    expect(measureInitialLoad(HTML, build(files), size).ok).toBe(true);
    expect(measureInitialLoad(HTML, build(files), size - 1).ok).toBe(false);
  });

  it('is not ok when a file could not be measured, even if the rest is small', () => {
    const r = measureInitialLoad('<script src="/a.js"></script><script src="/gone.js"></script>', build({ 'a.js': 'x' }), 100);
    expect(r.jsGzip).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('defaults to the 150 KB budget of SCOPE.md §5.6, counted as 1000 bytes per KB', () => {
    expect(INITIAL_JS_BUDGET_BYTES).toBe(150_000);
    expect(measureInitialLoad(HTML, build(files)).limit).toBe(150_000);
  });
});

describe('formatReport', () => {
  const files = { 'a.js': 'x'.repeat(79_320), 'b.js': 'x'.repeat(1550), 'a.css': 'x'.repeat(4770) };
  const html = '<script src="/a.js"></script><link rel="modulepreload" href="/b.js"><link rel="stylesheet" href="/a.css">';

  it('prints entry, chunk, css and total, with CSS marked as outside the budget', () => {
    const text = formatReport(measureInitialLoad(html, build(files)));
    expect(text).toBe(
      [
        'initial load, gzipped (javascript budget 150.00 KB)',
        '',
        '  entry   a.js          79.32 KB',
        '  chunk   b.js           1.55 KB',
        '  css     a.css          4.77 KB  (not in the budget)',
        '',
        '  total   javascript    80.87 KB  54% of budget, ok',
      ].join('\n'),
    );
  });

  it('says by how much the budget is exceeded', () => {
    const text = formatReport(measureInitialLoad(html, build(files), 80_000));
    expect(text).toContain('OVER by 0.87 KB');
  });

  it('lists problems under the table', () => {
    const text = formatReport(measureInitialLoad('<script src="/gone.js"></script>', build({})));
    expect(text).toContain('problem: gone.js is needed at start-up but is not in dist/');
  });
});
