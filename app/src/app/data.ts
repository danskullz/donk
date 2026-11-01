// Loads the content under /data (SCOPE.md §3.2, §7.6): the map index, each available map's record and callouts.
// The files are bundled with the app and checked with the same schemas as `pnpm content:validate`.
//
// Development and e2e builds also carry a synthetic map, `de_test`, built from the test fixtures. It exists so
// the screens can be built and tested before Mirage has callouts, and it is compiled out of production builds.

import indexJson from '../../../data/index.json';
import { ArtFileSchema, firstLevelArt } from '../core/artfile';
import { MapIndexSchema, type Callout, type MapRecord } from '../core/schema';
import { parseMapData } from '../core/validate';

export interface MapData {
  map: MapRecord;
  /** The map's callouts, whatever their status. */
  callouts: Callout[];
  /** Where a callout's screenshot file can be fetched from. */
  shotUrl(file: string): string;
  /** The synthetic development map: its progress is kept apart from the real log. */
  demo: boolean;
  /** SVG path data, in radar pixels, of the map's whole walkable surface: the silhouette drawn behind the regions
   *  (SCOPE §3.6, §6.8). Null until the content pipeline has generated it for this map. */
  art: string | null;
  /** The same silhouette for every level that has one, by level id (multi-floor maps). Absent when `art` is null. */
  artLevels?: Readonly<Record<string, string>>;
}

export const DEMO_MAP_ID = 'de_test';

const mapFiles = import.meta.glob<unknown>('../../../data/maps/*.json', { import: 'default' });
const calloutFiles = import.meta.glob<unknown>('../../../data/callouts/*.json', { import: 'default' });
// Map art is generated (`pnpm content:art`) and not committed, so the folder may not exist: the glob is then empty.
const artFiles = import.meta.glob<unknown>('../../../data/art/*.json', { import: 'default' });

/** Processed screenshots are served from /shots (assets/shots, SCOPE §8; tools/shots-plugin.ts). */
const shotUrl = (file: string) => `${import.meta.env.BASE_URL}shots/${file}`;

let cache: Promise<MapData[]> | null = null;

/**
 * The silhouette of a map from the loaders `import.meta.glob` gives for data/art (keyed by their path), or nothing when
 * it has not been generated or does not fit the map: the map still works without it. Exported so a test can pass
 * loaders of its own, because the real folder is generated, gitignored and empty on a fresh checkout.
 */
export async function loadMapArt(files: Readonly<Record<string, () => Promise<unknown>>>, map: MapRecord): Promise<Pick<MapData, 'art' | 'artLevels'>> {
  const load = files[`../../../data/art/${map.id}.json`];
  if (!load) return { art: null };
  let raw: unknown;
  try {
    raw = await load();
  } catch (e) {
    console.warn(`data/art/${map.id}.json could not be loaded (${e instanceof Error ? e.message : String(e)}); run pnpm content:art`);
    return { art: null };
  }
  const parsed = ArtFileSchema.safeParse(raw);
  const art = parsed.success ? firstLevelArt(parsed.data, map) : null;
  if (!parsed.success || art === null) {
    console.warn(`data/art/${map.id}.json is not usable (${parsed.success ? 'wrong map or no levels' : parsed.error.issues[0]?.message}); run pnpm content:art`);
    return { art: null };
  }
  return { art, artLevels: parsed.data.levels };
}

async function load(): Promise<MapData[]> {
  const index = MapIndexSchema.parse(indexJson);
  const out: MapData[] = [];
  for (const entry of index.filter((e) => e.available)) {
    const loadMap = mapFiles[`../../../data/maps/${entry.id}.json`];
    const loadCallouts = calloutFiles[`../../../data/callouts/${entry.id}.json`];
    if (!loadMap || !loadCallouts) throw new Error(`index.json lists ${entry.id} as available, but its data files are missing`);
    const parsed = parseMapData(await loadMap(), await loadCallouts());
    if (!parsed.map || !parsed.callouts) {
      const first = parsed.issues.find((i) => i.severity === 'error');
      throw new Error(`${entry.id} data is not valid${first ? `: ${first.message}` : ''}`);
    }
    out.push({ map: parsed.map, callouts: parsed.callouts, shotUrl, demo: false, ...(await loadMapArt(artFiles, parsed.map)) });
  }
  // The condition is written out here, not in a helper, so the bundler can see it is false and drop the import.
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') {
    const { demoMapData } = await import('../dev/demo-data');
    out.push(demoMapData());
  }
  return out;
}

/** Every map the app can play, loaded once. */
export function loadAvailableMaps(): Promise<MapData[]> {
  cache ??= load();
  return cache;
}
