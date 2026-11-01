import { describe, expect, it } from 'vitest';
import { captureManifest } from '../../src/core/editor/shotplan';
import { CalloutsFileSchema, type Callout, type Shot } from '../../src/core/schema';
import { bareCallouts, FIXTURE_MAP, manifestFor, planFor } from './fixtures';
import { CaptureManifestSchema, captureFileName, differences, fullEntry, localDate, mergeShots, planShots, shotFile, slugOf, titleNumber, type CaptureManifest } from './shots';

describe('slugOf and captureFileName', () => {
  it('lower-cases and turns every run of other characters into one hyphen, as capture_run.py does', () => {
    expect(slugOf('mirage.palace-inside-1')).toBe('mirage-palace-inside-1');
    expect(slugOf('Mirage.A_Site -- Inside 2')).toBe('mirage-a-site-inside-2');
    expect(slugOf('--x--')).toBe('x');
    expect(slugOf('')).toBe('');
  });

  it("names a planned shot after its title and the driver's own experiment shots after their note", () => {
    expect(captureFileName(7, 'mirage.palace-inside-1', 'retake planned')).toBe('shot_07_mirage-palace-inside-1.png');
    expect(captureFileName(3, 'anything', 'baseline hud')).toBe('shot_03_baseline-hud.png');
    expect(captureFileName(120, 'mirage.palace-inside-1', 'retake x')).toBe('shot_120_mirage-palace-inside-1.png');
  });
});

describe('shotFile and titleNumber', () => {
  it('drops the map prefix of the callout id and the de_ of the map', () => {
    expect(shotFile('de_mirage', 'mirage.palace', 2)).toBe('mirage/palace-2.avif');
    expect(shotFile('de_mirage', 'mirage.a-site', 1, 'webp')).toBe('mirage/a-site-1.webp');
    expect(shotFile('de_dust2', 'dust2.long_doors', 3)).toBe('dust2/long_doors-3.avif');
  });

  it('reads the shot number out of the title the Editor writes, and nothing else', () => {
    expect(titleNumber('mirage.palace-inside-2', 'mirage.palace', 'inside')).toBe(2);
    expect(titleNumber('mirage.palace-inside-12', 'mirage.palace', 'inside')).toBe(12);
    for (const bad of ['mirage.palace-inside-0', 'mirage.palace-inside-', 'mirage.palace-inside-x', 'mirage.palace-inside-01', 'mirage.palace-approach-1', 'mirage.pal-inside-1', 'free text']) {
      expect(titleNumber(bad, 'mirage.palace', 'inside')).toBeNull();
    }
  });
});

describe('CaptureManifestSchema', () => {
  it("accepts exactly what the Editor's captureManifest writes", () => {
    const callouts = bareCallouts();
    const manifest = manifestFor(callouts);
    expect(CaptureManifestSchema.safeParse(JSON.parse(JSON.stringify(manifest))).success).toBe(true);
    expect(manifest.shots.length).toBeGreaterThan(20);
  });

  it('rejects a shot with a kind or stance the schema does not know', () => {
    const manifest = manifestFor(bareCallouts().slice(0, 1));
    const bad = JSON.parse(JSON.stringify(manifest)) as CaptureManifest;
    (bad.shots[0] as { kind: string }).kind = 'selfie';
    expect(CaptureManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('planShots', () => {
  it('numbers each file by the number in the title, so a single retake keeps its name', () => {
    const callouts = bareCallouts();
    const plan = planFor(callouts);
    const full = planShots(manifestFor(callouts, plan));
    expect(full.problems).toEqual([]);
    const palace = full.planned.filter((p) => p.calloutId === 'test.palace');
    expect(palace.map((p) => p.file)).toEqual(['test/palace-1.avif', 'test/palace-2.avif', 'test/palace-3.avif']);

    // a manifest holding only palace's third shot still names it palace-3, not palace-1
    const only = manifestFor(callouts, plan);
    const third = { ...only, shots: only.shots.filter((s) => s.id === 'test.palace' && s.kind === 'alternate') };
    expect(planShots(third).planned.map((p) => p.file)).toEqual(['test/palace-3.avif']);
  });

  it('turns the pose into the entry and names the capture file', () => {
    const callouts = bareCallouts().slice(0, 1);
    const manifest = manifestFor(callouts);
    const { planned } = planShots(manifest);
    const first = planned[0]!;
    expect(first.capture).toBe('shot_01_test-t-spawn-inside-1.png');
    expect(first.entry).toEqual({ file: 'test/t-spawn-1.avif', pos: [100, 90, 64], yaw: 0, pitch: 0, stance: 'stand', kind: 'inside' });
    expect(first.n).toBe(1);
  });

  it('falls back to counting a callout\'s shots when a title is not the Editor\'s form', () => {
    const manifest = manifestFor(bareCallouts().slice(0, 1));
    const odd: CaptureManifest = { ...manifest, shots: manifest.shots.map((s) => ({ ...s, pose: { ...s.pose, title: `my own title ${s.n}` } })) };
    expect(planShots(odd).planned.map((p) => p.file)).toEqual(['test/t-spawn-1.avif', 'test/t-spawn-2.avif', 'test/t-spawn-3.avif']);
  });

  it('reports a shot of another map and two shots that would be the same file, and skips them', () => {
    const manifest = manifestFor(bareCallouts().slice(0, 1));
    const wrongMap = { ...manifest, shots: [...manifest.shots, { ...manifest.shots[0]!, n: 4, id: 'mirage.palace' }] };
    const a = planShots(wrongMap);
    expect(a.problems).toEqual(['shot 4: mirage.palace does not belong to de_test']);
    expect(a.planned).toHaveLength(3);

    const clash = { ...manifest, shots: [manifest.shots[0]!, { ...manifest.shots[0]!, n: 9 }] };
    const b = planShots(clash);
    expect(b.problems).toEqual(['shots 1 and 9 would both be test/t-spawn-1.avif']);
    expect(b.planned).toHaveLength(1);
  });
});

const entry = (over: Partial<Shot> = {}): Shot => ({ file: 'test/mid-1.avif', pos: [1, 2, 3], yaw: 10, pitch: 0, stance: 'stand', kind: 'inside', captured: '2026-11-02', build: '0000', ...over });
const withShots = (shots: Shot[]): Callout[] => bareCallouts().map((c) => (c.id === 'test.mid' ? { ...c, shots } : c));

describe('differences', () => {
  it('names the fields that differ and ignores the file name', () => {
    expect(differences(entry(), entry())).toEqual([]);
    expect(differences(entry(), entry({ yaw: 11, build: '1' }))).toEqual(['yaw', 'build']);
    expect(differences(entry(), entry({ pos: [1, 2, 4] }))).toEqual(['pos']);
    expect(differences(entry(), entry({ file: 'test/other.avif' }))).toEqual([]);
  });
});

describe('mergeShots', () => {
  it('adds an entry at the end of the callout and leaves the input untouched', () => {
    const before = withShots([entry({ file: 'test/mid-9.avif' })]);
    const out = mergeShots(before, [{ calloutId: 'test.mid', entry: entry() }], false);
    expect(out.rows).toEqual([{ calloutId: 'test.mid', file: 'test/mid-1.avif', status: 'added' }]);
    expect(out.callouts.find((c) => c.id === 'test.mid')?.shots.map((s) => s.file)).toEqual(['test/mid-9.avif', 'test/mid-1.avif']);
    expect(before.find((c) => c.id === 'test.mid')?.shots).toHaveLength(1);
  });

  it('leaves an identical entry alone, reports a different one as a conflict, and replaces it only with force', () => {
    const callouts = withShots([entry()]);
    expect(mergeShots(callouts, [{ calloutId: 'test.mid', entry: entry() }], false).rows[0]?.status).toBe('unchanged');

    const changed = entry({ yaw: 99 });
    const conflict = mergeShots(callouts, [{ calloutId: 'test.mid', entry: changed }], false);
    expect(conflict.rows[0]).toEqual({ calloutId: 'test.mid', file: 'test/mid-1.avif', status: 'conflict', differs: ['yaw'] });
    expect(conflict.callouts.find((c) => c.id === 'test.mid')?.shots[0]?.yaw).toBe(10);

    const forced = mergeShots(callouts, [{ calloutId: 'test.mid', entry: changed }], true);
    expect(forced.rows[0]?.status).toBe('replaced');
    expect(forced.callouts.find((c) => c.id === 'test.mid')?.shots).toEqual([changed]);
  });

  it('keeps the position of a replaced entry among the others', () => {
    const callouts = withShots([entry({ file: 'test/mid-1.avif' }), entry({ file: 'test/mid-2.avif' }), entry({ file: 'test/mid-3.avif' })]);
    const out = mergeShots(callouts, [{ calloutId: 'test.mid', entry: entry({ file: 'test/mid-2.avif', yaw: 77 }) }], true);
    expect(out.callouts.find((c) => c.id === 'test.mid')?.shots.map((s) => [s.file, s.yaw])).toEqual([['test/mid-1.avif', 10], ['test/mid-2.avif', 77], ['test/mid-3.avif', 10]]);
  });

  it('never creates a callout', () => {
    const out = mergeShots(bareCallouts(), [{ calloutId: 'test.nowhere', entry: entry({ file: 'test/nowhere-1.avif' }) }], true);
    expect(out.rows).toEqual([{ calloutId: 'test.nowhere', file: 'test/nowhere-1.avif', status: 'no-callout' }]);
    expect(out.callouts).toHaveLength(bareCallouts().length);
  });

  it('gives the same result when run twice on its own output (idempotent)', () => {
    const wanted = [
      { calloutId: 'test.mid', entry: entry() },
      { calloutId: 'test.mid', entry: entry({ file: 'test/mid-2.avif', kind: 'approach' }) },
    ];
    const once = mergeShots(bareCallouts(), wanted, false);
    const twice = mergeShots(once.callouts, wanted, false);
    expect(twice.callouts).toEqual(once.callouts);
    expect(twice.rows.map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(CalloutsFileSchema.safeParse(twice.callouts).success).toBe(true);
  });
});

describe('fullEntry', () => {
  it('orders the keys as the schema does, so the file diffs cleanly', () => {
    const plan = planShots(manifestFor(bareCallouts().slice(0, 1))).planned[0]!;
    expect(Object.keys(fullEntry(plan, '2026-11-02', '1'))).toEqual(['file', 'pos', 'yaw', 'pitch', 'stance', 'kind', 'captured', 'build']);
  });
});

describe('localDate', () => {
  it('is the local calendar date, zero padded', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDate(new Date(2026, 10, 2, 0, 1).getTime())).toBe('2026-11-02');
  });
});

describe('the Editor manifest and this reader agree', () => {
  it('names every capture file the way the driver would, for ids with hyphens and underscores', () => {
    const callouts = bareCallouts().map((c) => (c.id === 'test.a-ramp' ? { ...c, id: 'test.a_ramp-lower' } : c));
    const manifest = captureManifest({ map: FIXTURE_MAP, callouts, plan: planFor(callouts) });
    const names = planShots(CaptureManifestSchema.parse(manifest)).planned.filter((p) => p.calloutId === 'test.a_ramp-lower').map((p) => p.capture);
    expect(names[0]).toBe(`shot_${String(manifest.shots.find((s) => s.id === 'test.a_ramp-lower')!.n).padStart(2, '0')}_test-a-ramp-lower-inside-1.png`);
  });
});
