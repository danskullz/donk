// The build id the service worker is registered under (app/register-sw.ts). A new build must give a new id, or the
// browser keeps the old worker and the old cache; the same build must always give the same one, or every visit would
// install a new worker. Importing the file is safe here: it registers nothing outside a production build.

import { describe, expect, it } from 'vitest';
import { buildIdFrom } from './register-sw';

const page = ['https://callouts.test/assets/index-KooWkMzw.js', 'https://callouts.test/assets/index-BK9p81vq.css', 'https://callouts.test/assets/error-DwLpsZPe.js'];

describe('the build id', () => {
  it('is the same for the same build, whatever order the files were found in', () => {
    expect(buildIdFrom(page)).toBe(buildIdFrom([...page].reverse()));
    expect(buildIdFrom(page)).toBe(buildIdFrom([...page, ...page]));
  });

  it('changes when any hashed file changes', () => {
    const base = buildIdFrom(page);
    expect(buildIdFrom(page.map((u) => u.replace('KooWkMzw', 'KooWkMzx')))).not.toBe(base);
    expect(buildIdFrom(page.map((u) => u.replace('BK9p81vq', 'BK9p81vr')))).not.toBe(base);
    expect(buildIdFrom(page.slice(0, 2))).not.toBe(base);
  });

  it('is plain: lowercase letters and digits only, and short enough for a cache name', () => {
    expect(buildIdFrom(page)).toMatch(/^[a-z0-9]{1,24}$/);
    expect(buildIdFrom(['/assets/a.js'])).toMatch(/^[a-z0-9]{1,24}$/);
  });

  it('is accepted by the worker as it is (the worker keeps only ids like this)', () => {
    expect(buildIdFrom(page)).toMatch(/^[a-z0-9]{1,24}$/);
    expect(buildIdFrom(page)).not.toBe('dev');
  });

  it('is "dev" when the page has no build files, as in development', () => {
    expect(buildIdFrom([])).toBe('dev');
    expect(buildIdFrom(['https://callouts.test/src/main.ts', 'https://callouts.test/@vite/client'])).toBe('dev');
  });

  it('judges files by their path, not the host or a query string', () => {
    expect(buildIdFrom(['http://localhost:4173/assets/a-1.js?x=1'])).toBe(buildIdFrom(['https://callouts.test/assets/a-1.js']));
  });

  it('copes with an address it cannot parse', () => {
    expect(() => buildIdFrom(['http://[bad', '/assets/a-1.js'])).not.toThrow();
  });
});
