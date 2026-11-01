import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, createDerived } from './log';
import { applicableModes, masteryOf, stageCleared, unlockedModes, unlockedStages } from './mastery';
import { createScheduler, type Scheduler } from './scheduler';
import { makeCallouts } from './test-fixtures';
import { answer, drive, intro } from './test-helpers';
import { DAY_MS, Grade, MODES, PHASE1_MODES } from './types';

const T0 = Date.parse('2026-02-01T09:00:00Z');
const C = 'test.mid';
let s: Scheduler;
beforeAll(async () => {
  s = await createScheduler();
});

const mastery = (d: ReturnType<typeof createDerived>) => masteryOf(C, d, s, PHASE1_MODES);
const stages = (d: ReturnType<typeof createDerived>) => unlockedStages(C, d, s, PHASE1_MODES);

describe('the climb from New to Automatic', () => {
  it('goes through every state in order', () => {
    const d = createDerived();
    expect(mastery(d)).toBe('new');
    expect(stages(d)).toEqual([]);

    applyEvent(d, intro(C, T0), s);
    expect(mastery(d)).toBe('seen');
    expect(stages(d)).toEqual([1]);

    applyEvent(d, answer(C, 'name-mc', T0, Grade.Good), s);
    expect(mastery(d)).toBe('learning');
    expect(stages(d)).toEqual([1]);

    applyEvent(d, answer(C, 'read-map', T0, Grade.Good), s);
    applyEvent(d, answer(C, 'which-view', T0, Grade.Good), s);
    expect(mastery(d)).toBe('familiar');
    expect(stages(d)).toEqual([1, 2]);

    drive(d, s, C, 'pin', T0, [Grade.Good, Grade.Good]);
    expect(mastery(d)).toBe('known');
    expect(stages(d)).toEqual([1, 2, 3]);

    drive(d, s, C, 'name-typed', T0, [Grade.Good, Grade.Good]);
    expect(mastery(d)).toBe('automatic');
    expect(stages(d)).toEqual([1, 2, 3, 4]);
  });

  it('stays Known when the typed answers are slow', () => {
    const d = createDerived();
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Good), s);
    drive(d, s, C, 'pin', T0, [Grade.Good, Grade.Good]);
    drive(d, s, C, 'name-typed', T0, [Grade.Good, Grade.Good], 9000);
    expect(mastery(d)).toBe('known');
  });

  it('does not count a Hard first answer as stable enough (1.3 days)', () => {
    const d = createDerived();
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Hard), s);
    expect(mastery(d)).toBe('learning');
    expect(stages(d)).toEqual([1]);
  });

  it('cools off when a stable item lapses', () => {
    const d = createDerived();
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Good), s);
    expect(mastery(d)).toBe('familiar');
    applyEvent(d, answer(C, 'name-mc', T0 + 3 * DAY_MS, Grade.Again, 2000, 'test.palace'), s);
    expect(mastery(d)).toBe('learning');
  });

  it('needs every item of a stage, not just one', () => {
    const d = createDerived();
    applyEvent(d, answer(C, 'name-mc', T0, Grade.Good), s);
    applyEvent(d, answer(C, 'read-map', T0, Grade.Good), s);
    expect(stageCleared(C, 1, d, s, PHASE1_MODES, 2)).toBe(false);
    applyEvent(d, answer(C, 'which-view', T0, Grade.Good), s);
    expect(stageCleared(C, 1, d, s, PHASE1_MODES, 2)).toBe(true);
  });
});

describe('which modes are open', () => {
  it('lists the modes of the unlocked stages only', () => {
    const d = createDerived();
    applyEvent(d, intro(C, T0), s);
    expect(unlockedModes(C, d, s, PHASE1_MODES)).toEqual(['name-mc', 'read-map', 'which-view']);
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Good), s);
    expect(unlockedModes(C, d, s, PHASE1_MODES)).toEqual(['name-mc', 'read-map', 'which-view', 'pin']);
  });
  it('leaves out modes the learner switched off', () => {
    const d = createDerived();
    applyEvent(d, intro(C, T0), s);
    const noView = PHASE1_MODES.filter((m) => m !== 'which-view');
    expect(unlockedModes(C, d, s, noView)).toEqual(['name-mc', 'read-map']);
    applyEvent(d, answer(C, 'name-mc', T0, Grade.Good), s);
    applyEvent(d, answer(C, 'read-map', T0, Grade.Good), s);
    expect(unlockedStages(C, d, s, noView)).toEqual([1, 2]);
  });
  it('drops modes that need a screenshot when the callout has none', () => {
    const noShots = { ...makeCallouts()[1]!, shots: [] };
    expect(applicableModes(noShots, PHASE1_MODES)).toEqual(['read-map', 'pin', 'name-typed']);
    expect(applicableModes(makeCallouts()[1]!, PHASE1_MODES)).toEqual([...PHASE1_MODES]);
  });
});

describe('Speed call (stage 5, SCOPE §4.4)', () => {
  /** Recognise, Locate and Recall cleared; Where am I? answered right at each due date `times` times. */
  function placed(times: number) {
    const d = createDerived();
    applyEvent(d, intro(C, T0), s);
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Good), s);
    drive(d, s, C, 'pin', T0, [Grade.Good, Grade.Good]);
    drive(d, s, C, 'name-typed', T0, [Grade.Good, Grade.Good]);
    drive(d, s, C, 'where-am-i', T0, Array.from({ length: times }, () => Grade.Good));
    return d;
  }
  const whereStability = (d: ReturnType<typeof createDerived>) => s.stabilityDays(d.items.get(`${C}:where-am-i`)!.memory);

  it('is open only when Where am I? is stable for 21 days', () => {
    for (let times = 1; times <= 4; times++) {
      const d = placed(times);
      const open = whereStability(d) >= 21;
      expect(unlockedStages(C, d, s, MODES), `after ${times} reviews, stability ${whereStability(d).toFixed(1)}`).toEqual(open ? [1, 2, 3, 4, 5] : [1, 2, 3, 4]);
      expect(unlockedModes(C, d, s, MODES).includes('speed')).toBe(open);
    }
    expect(whereStability(placed(4))).toBeGreaterThanOrEqual(21);
    expect(whereStability(placed(1))).toBeLessThan(21);
  });

  it('stays shut while an earlier stage is not stable, however well Where am I? goes', () => {
    const d = createDerived();
    applyEvent(d, intro(C, T0), s);
    for (const m of ['name-mc', 'read-map', 'which-view'] as const) applyEvent(d, answer(C, m, T0, Grade.Good), s);
    drive(d, s, C, 'where-am-i', T0, [Grade.Good, Grade.Good, Grade.Good, Grade.Good]);
    expect(unlockedModes(C, d, s, MODES)).not.toContain('speed');
  });

  it('is not offered when the learner turned it off, or the callout has no screenshot', () => {
    const d = placed(4);
    expect(unlockedModes(C, d, s, PHASE1_MODES)).not.toContain('speed');
    const noShots = { ...makeCallouts()[1]!, shots: [] };
    expect(applicableModes(noShots, MODES)).not.toContain('speed');
    expect(applicableModes(makeCallouts()[1]!, MODES)).toContain('speed');
  });

  it('does not change the mastery state: Automatic is still about the typed answers', () => {
    expect(masteryOf(C, placed(4), s, MODES)).toBe('automatic');
  });
});
