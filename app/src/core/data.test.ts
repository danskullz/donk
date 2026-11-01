// The real content under /data must validate: this puts the content gate (SCOPE §7.7) in the normal test run.
// `pnpm content:validate` prints the same findings in full, warnings included.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MapIndexSchema } from './schema';
import { parseMapData } from './validate';

const dataUrl = (rel: string) => new URL(`../../../data/${rel}`, import.meta.url);
const readJson = (rel: string): unknown => JSON.parse(readFileSync(dataUrl(rel), 'utf8'));

describe('/data', () => {
  const index = MapIndexSchema.safeParse(readJson('index.json'));

  it('has a valid map index', () => {
    expect(index.success).toBe(true);
  });

  const maps = index.success ? index.data : [];
  it('lists the ten maps of SCOPE §3.1', () => {
    expect(maps.map((m) => m.id).sort()).toEqual(
      ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'].sort(),
    );
  });

  for (const entry of maps.filter((m) => m.available)) {
    it(`${entry.id}: files exist and validate with no errors`, () => {
      expect(existsSync(dataUrl(`maps/${entry.id}.json`)), 'map file').toBe(true);
      expect(existsSync(dataUrl(`callouts/${entry.id}.json`)), 'callouts file').toBe(true);
      const parsed = parseMapData(readJson(`maps/${entry.id}.json`), readJson(`callouts/${entry.id}.json`));
      const errors = parsed.issues.filter((i) => i.severity === 'error').map((i) => `[${i.rule}] ${i.callout ?? ''} ${i.message}`);
      expect(errors).toEqual([]);
      expect(parsed.map?.id).toBe(entry.id);
      expect(parsed.map?.displayName).toBe(entry.displayName);
      expect(parsed.map?.pool).toBe(entry.pool);
    });
  }

  it('uses the real Mirage projection from the game files (SCOPE §3.2)', () => {
    const mirage = readJson('maps/de_mirage.json') as { projection: unknown };
    expect(mirage.projection).toEqual({ posX: -3230, posY: 1713, scale: 5 });
  });
});
