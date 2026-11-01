import { describe, expect, it } from 'vitest';
import { makeCallouts, makeMap, makeTestData } from './test-fixtures';
import { LIMITS } from './schema';
import { parseMapData, validateMapData, type Issue } from './validate';

const rules = (issues: readonly Issue[], severity?: Issue['severity']) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.rule);

describe('the fixture', () => {
  it('is valid: no errors', () => {
    const { map, callouts } = makeTestData();
    expect(rules(validateMapData(map, callouts), 'error')).toEqual([]);
  });
  it('parses from plain JSON the way the files will be read', () => {
    const { map, callouts } = makeTestData();
    const parsed = parseMapData(JSON.parse(JSON.stringify(map)), JSON.parse(JSON.stringify(callouts)));
    expect(rules(parsed.issues, 'error')).toEqual([]);
    expect(parsed.map?.radarSize).toBe(1024);
    expect(parsed.callouts).toHaveLength(callouts.length);
  });
});

describe('schema limits (SCOPE §5.3 rule 4)', () => {
  const parse = (patch: (c: Record<string, unknown>) => void) => {
    const { map, callouts } = makeTestData();
    const raw = JSON.parse(JSON.stringify(callouts)) as Record<string, unknown>[];
    patch(raw[0] as Record<string, unknown>);
    return parseMapData(map, raw);
  };

  it('rejects a name over 28 characters and accepts exactly 28', () => {
    expect(rules(parse((c) => (c['name'] = 'x'.repeat(LIMITS.name + 1))).issues, 'error')).toContain('callout-schema');
    expect(rules(parse((c) => (c['name'] = 'x'.repeat(LIMITS.name))).issues, 'error')).toEqual([]);
  });
  it('rejects a blurb over 120 characters', () => {
    expect(rules(parse((c) => (c['blurb'] = 'x'.repeat(LIMITS.blurb + 1))).issues, 'error')).toContain('callout-schema');
  });
  it('rejects more than five aliases and more than four neighbours', () => {
    expect(rules(parse((c) => (c['aliases'] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])).issues, 'error')).toContain('callout-schema');
    const many = ['test.mid', 'test.a-ramp', 'test.a-site', 'test.palace', 'test.connector'];
    expect(rules(parse((c) => (c['neighbours'] = many)).issues, 'error')).toContain('callout-schema');
  });
  it('rejects unknown fields so typos in the data do not pass silently', () => {
    expect(rules(parse((c) => (c['blurp'] = 'x')).issues, 'error')).toContain('callout-schema');
  });
  it('names the callout in the message', () => {
    const issues = parse((c) => (c['name'] = '')).issues;
    expect(issues[0]?.callout).toBe('test.t-spawn');
  });
});

describe('cross-record checks', () => {
  function run(change: (map: ReturnType<typeof makeMap>, callouts: ReturnType<typeof makeCallouts>) => void) {
    const { map, callouts } = makeTestData();
    change(map, callouts);
    return validateMapData(map, callouts);
  }
  const get = (callouts: ReturnType<typeof makeCallouts>, slug: string) => callouts.find((c) => c.id === `test.${slug}`)!;

  it('flags duplicate ids', () => {
    expect(rules(run((_, c) => c.push({ ...get(c, 'mid') })), 'error')).toContain('id-duplicate');
  });
  it('flags an id with the wrong map prefix and a callout of another map', () => {
    expect(rules(run((_, c) => (get(c, 'mid').id = 'other.mid')), 'error')).toContain('id-prefix');
    expect(rules(run((_, c) => (get(c, 'mid').map = 'de_mirage')), 'error')).toContain('map-mismatch');
  });
  it('flags a name or alias that two callouts share', () => {
    const issues = run((_, c) => get(c, 'palace').aliases.push('b site'));
    expect(rules(issues, 'error')).toContain('name-collision');
  });
  it('warns when an alias repeats the name', () => {
    const issues = run((_, c) => get(c, 'mid').aliases.push('MID'));
    expect(rules(issues, 'warning')).toContain('alias-duplicate');
  });
  it('flags unknown zones and levels', () => {
    expect(rules(run((_, c) => (get(c, 'mid').zone = 'nowhere')), 'error')).toContain('zone-unknown');
    expect(rules(run((_, c) => (get(c, 'mid').level = 'lower')), 'error')).toContain('level-unknown');
  });
  it('flags a self-intersecting region and a region off the radar', () => {
    expect(rules(run((_, c) => (get(c, 'mid').region = [[200, 0], [400, 200], [400, 0], [200, 200]])), 'error')).toContain('region-invalid');
    expect(rules(run((_, c) => (get(c, 'mid').region = [[5000, 0], [5200, 0], [5200, 200], [5000, 200]])), 'error')).toContain('region-bounds');
  });
  it('flags a tiny region and an anchor outside its region', () => {
    expect(rules(run((_, c) => (get(c, 'mid').region = [[200, 0], [205, 0], [205, 5], [200, 5]])), 'error')).toContain('region-tiny');
    expect(rules(run((_, c) => (get(c, 'mid').anchor = [900, 900])), 'error')).toContain('anchor-outside');
  });
  it('flags bad neighbours: unknown, self, duplicate; warns when one-way', () => {
    expect(rules(run((_, c) => get(c, 'mid').neighbours.push('test.nope')), 'error')).toContain('neighbour-unknown');
    expect(rules(run((_, c) => get(c, 'mid').neighbours.push('test.mid')), 'error')).toContain('neighbour-self');
    expect(rules(run((_, c) => get(c, 'mid').neighbours.push('test.t-spawn')), 'error')).toContain('neighbour-duplicate');
    expect(rules(run((_, c) => (get(c, 'palace').neighbours = []))).filter((r) => r === 'neighbour-one-way')).toHaveLength(1);
  });
  it('requires Hard spots to have a parent that contains them', () => {
    expect(rules(run((_, c) => (get(c, 'bench').parent = null)), 'error')).toContain('parent-missing');
    expect(rules(run((_, c) => (get(c, 'bench').parent = 'test.nope')), 'error')).toContain('parent-unknown');
    expect(rules(run((_, c) => (get(c, 'bench').parent = 'test.b-site')), 'error')).toContain('parent-contain');
    expect(rules(run((_, c) => (get(c, 'bench').parent = 'test.bench')), 'error')).toContain('parent-tier');
    expect(rules(run((_, c) => (get(c, 'mid').parent = 'test.a-site')), 'error')).toContain('parent-not-hard');
  });
  it('treats missing shots as a warning on a draft and an error on a verified callout', () => {
    expect(rules(run((_, c) => get(c, 'mid').shots.pop()), 'warning')).toContain('shots-min');
    const verified = run((_, c) => {
      get(c, 'mid').shots.pop();
      get(c, 'mid').status = 'verified';
    });
    expect(rules(verified, 'error')).toContain('shots-min');
  });
  it('wants an approach shot, unique shot files, and shots on the radar', () => {
    expect(rules(run((_, c) => get(c, 'mid').shots.forEach((s) => (s.kind = 'inside'))), 'warning')).toContain('shots-no-approach');
    expect(rules(run((_, c) => (get(c, 'mid').shots[1]!.file = get(c, 'mid').shots[0]!.file)), 'error')).toContain('shot-duplicate');
    expect(rules(run((_, c) => (get(c, 'mid').shots[0]!.pos = [9000, 0, 64])), 'error')).toContain('shot-bounds');
  });
  it('blocks a verified map while a Tier 1 or 2 callout is not verified, but not for Tier 3', () => {
    const issues = run((m, c) => {
      m.status = 'verified';
      for (const x of c) if (x.tier !== 3) x.status = 'verified';
    });
    expect(rules(issues, 'error')).not.toContain('map-verified');
    const bad = run((m) => (m.status = 'verified'));
    expect(rules(bad, 'error')).toContain('map-verified');
  });
  it('warns about stale callouts and empty zones', () => {
    expect(rules(run((_, c) => (get(c, 'mid').status = 'stale')), 'warning')).toContain('stale');
    expect(rules(run((m) => m.zones.push({ id: 'extra', name: 'Extra' })), 'warning')).toContain('zone-empty');
  });
  it('lists errors before warnings', () => {
    const issues = run((_, c) => {
      get(c, 'mid').zone = 'nowhere';
      get(c, 'palace').neighbours = [];
    });
    const firstWarning = issues.findIndex((i) => i.severity === 'warning');
    expect(firstWarning).toBeGreaterThan(0);
    expect(issues.slice(0, firstWarning).every((i) => i.severity === 'error')).toBe(true);
  });
});
