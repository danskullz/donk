// How map art reaches MapData (SCOPE §3.6): present, absent, for another map, broken. The real data/art folder is
// generated and gitignored, so these pass loaders of their own to `loadMapArt`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapRecord } from '../core/schema';
import { makeMap } from '../core/test-fixtures';
import { DEMO_MAP_ID, loadAvailableMaps, loadMapArt } from './data';

const KEY = '../../../data/art/de_test.json';
const art = { map: 'de_test', gameBuild: '0000', levels: { default: 'M500 300l400 0 0 200-400 0z', lower: 'M0 0l9 0 0 9z' } };
const twoLevels = (): MapRecord => ({ ...makeMap(), levels: [{ id: 'default' }, { id: 'lower' }] });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('loadMapArt', () => {
  it('has no art, and says nothing, when the folder is empty', async () => {
    expect(await loadMapArt({}, makeMap())).toEqual({ art: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("carries the first level's path as `art` and every level as `artLevels`", async () => {
    const out = await loadMapArt({ [KEY]: async () => art }, twoLevels());
    expect(out).toEqual({ art: 'M500 300l400 0 0 200-400 0z', artLevels: art.levels });
  });

  it("follows the map record's level order, not the file's", async () => {
    const map = { ...makeMap(), levels: [{ id: 'lower' }, { id: 'default' }] };
    expect((await loadMapArt({ [KEY]: async () => art }, map)).art).toBe('M0 0l9 0 0 9z');
  });

  it('ignores art for another map, with a warning that says how to fix it', async () => {
    expect(await loadMapArt({ [KEY]: async () => ({ ...art, map: 'de_mirage' }) }, makeMap())).toEqual({ art: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('pnpm content:art');
  });

  it('ignores a file that does not fit the schema (a path with characters the generator never writes)', async () => {
    expect(await loadMapArt({ [KEY]: async () => ({ ...art, levels: { default: '<script>alert(1)</script>' } }) }, makeMap())).toEqual({ art: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a file that cannot be loaded at all', async () => {
    expect(
      await loadMapArt(
        {
          [KEY]: async () => {
            throw new Error('boom');
          },
        },
        makeMap(),
      ),
    ).toEqual({ art: null });
    expect(String(warn.mock.calls[0]?.[0])).toContain('boom');
  });
});

describe('loadAvailableMaps', () => {
  it('lists the available maps and the synthetic one', async () => {
    const maps = await loadAvailableMaps();
    expect(maps.map((m) => m.map.id)).toEqual(['de_mirage', DEMO_MAP_ID]);
    expect(maps.map((m) => m.demo)).toEqual([false, true]);
    // data/art is generated: a real map has art once `pnpm content:art` has run on this machine, and none before; the
    // synthetic map never does
    const [mirage, demo] = maps;
    expect(mirage?.art === null || /^M/.test(mirage?.art ?? '')).toBe(true);
    expect(demo?.art).toBeNull();
  });

  it('builds screenshot addresses under /shots for the real map', async () => {
    const mirage = (await loadAvailableMaps())[0];
    expect(mirage?.shotUrl('mirage/palace-1.avif')).toBe(`${import.meta.env.BASE_URL}shots/mirage/palace-1.avif`);
  });
});
