// Helpers for the browser tests: play a session by reading what is on screen through the test hook
// (src/screens/session/test-hook.ts), seed the browser's storage with a learner who has a history, and check that a
// screen fits its window (the Playwright version of the comps' design/fit_check.py, SCOPE §5.3 rule 9).

import { expect, type Page } from '@playwright/test';
import { applyEvent, createDerived, type ReviewEvent } from '../src/core/log';
import { createScheduler } from '../src/core/scheduler';
import { makeCallouts } from '../src/core/test-fixtures';
import { DAY_MS, Grade, itemKey, type GradeValue, type Mode } from '../src/core/types';
import type { ViewSnapshot } from '../src/screens/session/test-hook';

export const DEMO_DB = 'callouts-demo';

type Hooked = Window & { __callouts?: { snapshot: () => ViewSnapshot | null } };

export async function snapshot(page: Page): Promise<ViewSnapshot | null> {
  return page.evaluate(() => (window as Hooked).__callouts?.snapshot() ?? null);
}

/** Wait until the session has loaded and something is on screen. */
export async function ready(page: Page): Promise<ViewSnapshot> {
  await page.waitForFunction(() => (window as Hooked).__callouts?.snapshot() != null);
  return (await snapshot(page)) as ViewSnapshot;
}

/** Wait for the screen to change from what `before` was. */
async function changed(page: Page, before: ViewSnapshot): Promise<void> {
  const key = JSON.stringify(before);
  await page.waitForFunction((k) => JSON.stringify((window as Hooked).__callouts?.snapshot() ?? null) !== k, key);
}

export interface PlayOptions {
  /** Pick a wrong answer instead of the right one. */
  wrong?: boolean;
  /** Called with each screen before it is acted on. Return true when it has dealt with the screen itself. */
  onStep?: (snap: ViewSnapshot) => Promise<boolean | void>;
  /** Stop after this many screens. */
  maxSteps?: number;
}

/** Give an answer to the question on screen, the way a person would: a click, a key or typing. */
export async function answerQuestion(page: Page, snap: ViewSnapshot, wrong = false): Promise<void> {
  const target = snap.target;
  if (!target) throw new Error('no question on screen');
  const pickIndex = (ids: string[]) => {
    const right = ids.indexOf(target.id);
    return wrong ? (right + 1) % ids.length : right;
  };
  switch (snap.mode) {
    case 'name-mc':
    case 'read-map':
      await page.locator('.opt').nth(pickIndex(snap.options.map((o) => o.id))).click();
      break;
    case 'which-view':
      await page.locator('.view').nth(pickIndex(snap.options.map((o) => o.id))).click();
      break;
    case 'name-typed':
      await page.locator('.field input').fill(wrong ? 'zzzz' : target.name);
      await page.keyboard.press('Enter');
      break;
    case 'pin':
    case 'where-am-i': {
      const regions = await page.locator('path.rg[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      const name = wrong ? (regions.find((r) => r !== target.name) ?? target.name) : target.name;
      await page.locator(`path.rg[aria-label="${name}"]`).click();
      break;
    }
    default:
      throw new Error(`unexpected mode ${String(snap.mode)}`);
  }
}

/** Play the session to its end. Returns the final screen. */
export async function play(page: Page, options: PlayOptions = {}): Promise<ViewSnapshot> {
  let snap = await ready(page);
  for (let step = 0; step < (options.maxSteps ?? 400); step++) {
    const handled = await options.onStep?.(snap);
    if (snap.phase === 'done') return snap;
    if (handled) {
      snap = (await snapshot(page)) as ViewSnapshot;
      continue;
    }
    if (snap.phase === 'intro' || snap.phase === 'reveal') await page.getByRole('button', { name: 'Continue' }).click();
    else await answerQuestion(page, snap, options.wrong);
    await changed(page, snap);
    snap = (await snapshot(page)) as ViewSnapshot;
  }
  throw new Error('the session did not end');
}

/** Everything stored in the demo map's review log. */
export async function savedEvents(page: Page): Promise<ReviewEvent[]> {
  return page.evaluate(
    (name) =>
      new Promise<ReviewEvent[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        // Reading must never create the database: the app's own first open does that, with the right store.
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onerror = () => (open.error?.name === 'AbortError' ? resolve([]) : reject(open.error));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('events')) return resolve([]);
          const all = db.transaction('events').objectStore('events').getAll();
          all.onsuccess = () => resolve(all.result as ReviewEvent[]);
          all.onerror = () => reject(all.error);
        };
      }),
    DEMO_DB,
  );
}

/**
 * A learner with a history: every standard callout has been met and answered in every mode 60 days ago, so
 * everything is due and every mode comes up. For two callouts the typed stage has just opened and was never asked,
 * so the first typed question of an item (with suggestions) can be seen.
 */
export async function seedVeteran(page: Page, now = Date.now()): Promise<{ typedFresh: string[] }> {
  const scheduler = await createScheduler();
  const state = createDerived();
  const events: ReviewEvent[] = [];
  let n = 0;
  const add = (e: ReviewEvent) => {
    events.push(e);
    applyEvent(state, e, scheduler);
  };
  const answer = (callout: string, mode: Mode, ts: number, rating: GradeValue = Grade.Good) =>
    add({ kind: 'answer', id: `seed-${(n += 1)}`, ts, callout, mode, correct: true, latencyMs: 1500, hint: false, rating, chosen: null });

  const base = now - 60 * DAY_MS;
  const typedFresh = ['test.a-ramp', 'test.mid'];
  for (const c of makeCallouts().filter((x) => x.tier !== 3)) {
    // every first answer is at the same moment, so the modes are equally overdue and each shows up in the session
    add({ kind: 'intro', id: `seed-${(n += 1)}`, ts: base, callout: c.id });
    for (const m of ['name-mc', 'read-map', 'which-view', 'pin'] as const) answer(c.id, m, base + 1000);
    if (typedFresh.includes(c.id)) {
      // review the pin item on its due dates until the Place stage's gate (stability 5) is passed, so Recall opens
      let guard = 0;
      while (scheduler.stabilityDays(state.items.get(itemKey(c.id, 'pin'))!.memory) < 5 && guard++ < 6) {
        answer(c.id, 'pin', scheduler.dueAt(state.items.get(itemKey(c.id, 'pin'))!.memory).getTime());
      }
    } else {
      answer(c.id, 'name-typed', base + 1000);
    }
    answer(c.id, 'where-am-i', base + 1000);
  }

  await page.goto('/');
  await page.evaluate(
    ([name, rows]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name as string, 1);
        open.onupgradeneeded = () => {
          const store = open.result.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('ts', 'ts');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('events', 'readwrite');
          for (const row of rows as ReviewEvent[]) tx.objectStore('events').put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [DEMO_DB, events] as const,
  );
  return { typedFresh };
}

export interface FitReport {
  /** Document wider or taller than the window, in pixels. 0 when it fits. */
  x: number;
  y: number;
  /** Elements that stick out of the window. */
  outside: string[];
  /** Elements that clip their own content vertically. */
  clipped: string[];
}

export async function fitReport(page: Page): Promise<FitReport> {
  return page.evaluate(() => {
    const w = innerWidth;
    const h = innerHeight;
    const doc = document.documentElement;
    const outside: string[] = [];
    const clipped: string[] = [];
    const label = (e: Element) => `${e.tagName.toLowerCase()}.${(e.getAttribute('class') ?? '').trim().replace(/\s+/g, '.')}`;
    for (const e of document.querySelectorAll('.app *')) {
      if ((e.closest('svg') && e.tagName.toLowerCase() !== 'svg') || e.closest('.sr-only')) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.right > w + 1 || r.bottom > h + 1 || r.left < -1 || r.top < -1)) {
        outside.push(`${label(e)}@${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      const css = getComputedStyle(e);
      if (e.scrollHeight > e.clientHeight + 1 && css.overflowY !== 'visible' && e.clientHeight > 2 && e.tagName.toLowerCase() !== 'svg') {
        clipped.push(`${label(e)}:${e.scrollHeight}>${e.clientHeight}`);
      }
    }
    return { x: doc.scrollWidth - w, y: doc.scrollHeight - h, outside: outside.slice(0, 8), clipped: clipped.slice(0, 8) };
  });
}

export async function expectFits(page: Page, context: string): Promise<void> {
  const report = await fitReport(page);
  expect(report, context).toEqual({ x: 0, y: 0, outside: [], clipped: [] });
}
