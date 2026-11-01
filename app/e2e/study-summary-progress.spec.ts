// Browser tests for Study, Summary, Progress and the Primer (work package B). Like the other specs they drive the app on
// the synthetic map `de_test` (the e2e build, app/.env.e2e), never the real review log: the log the Progress screen reads is
// seeded into the demo database (`callouts-demo`) through IndexedDB, and Summary is handed a session through the hook the
// Summary module installs in development and e2e builds (`window.__calloutsStudy`, the counterpart of the session's
// `__callouts` hook, which only reads).
//
// Zones of the synthetic map, in route order: Spawn (T Spawn), Mid (Mid, Connector), A (A Ramp, A Site, Palace and the Hard
// spot Bench), B (B Site, B Apartments). Shown names are the callouts' own; the app lowercases them with CSS, so text is
// matched on the raw text content.

import { expect, test, type Page } from '@playwright/test';
import type { LastSession } from '../src/app/last-session';
import type { ReviewEvent } from '../src/core/log';
import { dateKey, startOfDay } from '../src/core/stats';
import { DEMO_DB, expectFits, savedEvents } from './support';

const VIEWPORTS = [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [1024, 600],
  [768, 1024],
  [390, 844],
  [360, 640],
  [844, 390],
  [640, 360],
] as const;

const SETTINGS_KEY = 'callouts.settings';
const DAY = 86_400_000;

// ---- helpers ---------------------------------------------------------------------------------------------------------

type Hooked = Window & { __calloutsStudy?: { setLastSession: (s: LastSession) => void; clearLastSession: () => void } };

/** Settings the app starts with, whatever page it opens on. */
async function useSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)), [SETTINGS_KEY, settings] as const);
}

/** Wait for fonts and two frames, so measured layouts (the lists, the charts) have settled before they are checked. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
}

/** Put events into the synthetic map's review log, the way the app's own store lays the database out. */
async function seedDemoLog(page: Page, events: ReviewEvent[]): Promise<void> {
  await page.goto('/#/primer'); // any page of the app: IndexedDB needs the origin, and the primer reads nothing
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
}

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
}

async function setViewport(page: Page, [width, height]: readonly [number, number]): Promise<void> {
  await page.setViewportSize({ width, height });
}

const answer = (n: number, ts: number, callout: string, correct: boolean, latencyMs: number, chosen: string | null = null): ReviewEvent => ({
  kind: 'answer',
  id: `e2e-${n}`,
  ts,
  callout,
  mode: 'name-mc',
  correct,
  latencyMs,
  hint: false,
  rating: correct ? 3 : 1,
  chosen,
});
const intro = (n: number, ts: number, callout: string): ReviewEvent => ({ kind: 'intro', id: `e2e-${n}`, ts, callout });

/**
 * A small history with known numbers. "Today" is the local day the test runs on and every event is placed inside it
 * from its midnight, so the day cannot change under the test. Yesterday's right answers are all 1800 ms, so the median
 * time of this week's right answers is 1800 ms whether or not yesterday falls in the same week.
 *
 *   today        4 answers: 3 right (1200, 1800, 2400 ms), 1 wrong (Palace taken for A Ramp)
 *   yesterday    2 answers, both right, 1800 ms
 *   10 days ago  1 answer, wrong (Palace taken for A Ramp again)
 *   40 days ago  2 answers: 1 right (3000 ms), 1 wrong (Mid taken for Connector, once only)
 *   and an intro card for T Spawn.
 * 9 answers, 6 right (67 %), 4 days practised, 5 callouts met (Palace, A Ramp, Mid, Connector, T Spawn).
 */
function history(now: number): ReviewEvent[] {
  const today = startOfDay(now);
  const at = (days: number, seconds: number) => startOfDay(today - days * DAY + 12 * 3_600_000) + seconds * 1000;
  return [
    intro(1, at(41, 1), 'test.t-spawn'),
    answer(2, at(40, 1), 'test.mid', true, 3000),
    answer(3, at(40, 2), 'test.mid', false, 5000, 'test.connector'),
    answer(4, at(10, 1), 'test.palace', false, 5000, 'test.a-ramp'),
    answer(5, at(1, 1), 'test.a-ramp', true, 1800),
    answer(6, at(1, 2), 'test.connector', true, 1800),
    answer(7, today + 1000, 'test.palace', true, 1200),
    answer(8, today + 2000, 'test.a-ramp', true, 1800),
    answer(9, today + 3000, 'test.mid', true, 2400),
    answer(10, today + 4000, 'test.palace', false, 5000, 'test.a-ramp'),
  ];
}

// ================================================================================================== Study ==============

test.describe('Study', () => {
  const STUDY = '/#/study/de_test';
  const row = (page: Page, name: string) => page.locator('.st-row', { hasText: name });
  const selected = (page: Page) => page.locator('.st-row[aria-current="true"] .st-nm');
  const zone = (page: Page) => page.locator('.st-zname b');
  /** Open the screen and wait until it has loaded: Study ignores keys while its data is still on the way. */
  async function open(page: Page, url = STUDY): Promise<void> {
    await page.goto(url);
    await expect(page.locator('.st-row[aria-current="true"]')).toBeVisible();
  }

  test('opens on the first zone with its first callout selected, and shows the picture, the map and the details', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('T Spawn');
    await expect(zone(page)).toHaveText('Spawn');
    await expect(selected(page)).toHaveText('T Spawn');
    await expect(page.locator('.st-shot img')).toBeVisible();
    await expect(page.locator('.st-thumb')).toHaveCount(3);
    await expect(page.locator('.st-blurb')).toHaveText('T Spawn in the test map.');
    await expect(page.getByRole('group', { name: /^Test, T Spawn selected/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quiz this map' })).toHaveAttribute('href', '#/session/de_test');
  });

  test('keys: arrows step through a zone, brackets and Page Up/Down change zone, digits pick the screenshot', async ({ page }) => {
    await open(page);
    await expect(selected(page)).toHaveText('T Spawn');

    await page.keyboard.press(']');
    await expect(zone(page)).toHaveText('Mid');
    await expect(selected(page)).toHaveText('Mid');
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText('Connector');
    await page.keyboard.press('ArrowRight'); // the end of the zone: a tour does not run on into the next one
    await expect(selected(page)).toHaveText('Connector');
    await page.keyboard.press('ArrowLeft');
    await expect(selected(page)).toHaveText('Mid');

    await page.keyboard.press('3');
    await expect(page.locator('.st-thumb').nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.st-cap')).toContainText('3 of 3');
    await page.keyboard.press('2');
    await expect(page.locator('.st-cap')).toContainText('inside view · 2 of 3');
    await page.keyboard.press('9'); // there is no ninth screenshot: nothing changes
    await expect(page.locator('.st-cap')).toContainText('2 of 3');

    await page.keyboard.press('PageDown');
    await expect(zone(page)).toHaveText('A');
    await expect(selected(page)).toHaveText('A Ramp');
    await page.keyboard.press('PageUp');
    await expect(zone(page)).toHaveText('Mid');
    await page.keyboard.press('['); // back to the first zone; there is none before it
    await page.keyboard.press('[');
    await expect(zone(page)).toHaveText('Spawn');
  });

  test('a new callout starts on its first screenshot', async ({ page }) => {
    await open(page);
    await page.keyboard.press(']');
    await page.keyboard.press('3');
    await expect(page.locator('.st-thumb').nth(2)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.st-thumb').nth(0)).toHaveAttribute('aria-current', 'true');
  });

  test('the list is a keyboard route of its own: Up and Down move the selection and keep the focus on the list', async ({ page }) => {
    await open(page);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown'); // zone A
    await row(page, 'A Ramp').focus();
    await page.keyboard.press('ArrowDown');
    await expect(selected(page)).toHaveText('A Site');
    await expect(row(page, 'A Site')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'Palace')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(row(page, 'A Site')).toBeFocused();
    await expect(page.locator('.st-pos')).toHaveText('2 / 3');
  });

  test('the map, the list and the details follow each other', async ({ page }) => {
    await open(page);
    // a click on the map: the zone changes with it
    await page.locator('path.rg[aria-label^="Palace"]').click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Palace');
    await expect(zone(page)).toHaveText('A');
    await expect(selected(page)).toHaveText('Palace');
    // a neighbour chip
    await page.locator('.st-nb', { hasText: 'A Site' }).click();
    await expect(selected(page)).toHaveText('A Site');
    // a row
    await row(page, 'A Ramp').click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('A Ramp');
    await expect(page.locator('.st-alias')).toContainText('Ramp'); // its alias
    // a neighbour in another zone
    await page.locator('.st-nb', { hasText: 'Mid' }).click();
    await expect(zone(page)).toHaveText('Mid');
    await expect(selected(page)).toHaveText('Mid');
  });

  test('zone buttons and the tour buttons do what their labels say, and stop at the ends', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Previous zone' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous callout' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next zone' }).click();
    await expect(zone(page)).toHaveText('Mid');
    await page.getByRole('button', { name: 'Next callout' }).click();
    await expect(selected(page)).toHaveText('Connector');
    await expect(page.getByRole('button', { name: 'Next callout' })).toBeDisabled();
    await expect(page.locator('.st-pos')).toHaveText('2 / 2');
    await page.getByRole('button', { name: 'Next zone' }).click();
    await page.getByRole('button', { name: 'Next zone' }).click();
    await expect(zone(page)).toHaveText('B');
    await expect(page.getByRole('button', { name: 'Next zone' })).toBeDisabled();
  });

  test('filters by tier and by mastery state, and says so when nothing matches', async ({ page }) => {
    await seedDemoLog(page, [intro(1, Date.now() - 1000, 'test.palace')]); // Palace has been introduced: Seen
    await open(page);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown'); // zone A: A Ramp (Core), A Site (Core), Palace (Standard)
    await expect(page.locator('.st-row')).toHaveCount(3);
    await expect(row(page, 'Palace').locator('.st-st')).toHaveText('Seen');
    await expect(row(page, 'A Ramp').locator('.st-st')).toHaveText('New');

    await page.getByLabel('Tier').selectOption('2');
    await expect(page.locator('.st-row')).toHaveCount(1);
    await expect(selected(page)).toHaveText('Palace');

    await page.getByLabel('Tier').selectOption('1');
    await expect(page.locator('.st-row')).toHaveCount(2);
    await expect(selected(page)).toHaveText('A Ramp'); // Palace is filtered out, the first row takes over

    await page.getByLabel('State').selectOption('known');
    await expect(page.locator('.st-row')).toHaveCount(0);
    await expect(page.locator('.st-pager')).toContainText('Nothing matches');
    await expect(page.locator('.st-about')).toContainText('No callout matches these filters');
    await page.locator('.st-pager').getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('.st-row')).toHaveCount(3);

    // keys do nothing while a select has the focus: they belong to it
    await page.getByLabel('Tier').focus();
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText('A Ramp');
  });

  test('a pick on the map beats the filters: it shows all and selects what was picked', async ({ page }) => {
    await open(page);
    await page.getByLabel('Tier').selectOption('1');
    await expect(page.locator('.st-row')).toHaveCount(1);
    await page.locator('path.rg[aria-label^="Connector"]').click(); // Standard, so the Core filter hides it
    await expect(selected(page)).toHaveText('Connector');
    await expect(page.getByLabel('Tier')).toHaveValue('all');
  });

  test('Hard spots appear only when Hard mode is on for the map, nested under their callout', async ({ page }) => {
    await open(page);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect(page.locator('.st-row')).toHaveCount(3);
    await expect(page.getByLabel('Tier').locator('option[value="3"]')).toHaveCount(0);
    await expect(row(page, 'Bench')).toHaveCount(0);
  });

  test('with Hard mode on', async ({ page }) => {
    await useSettings(page, { hardMode: { de_test: true } });
    await open(page);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect(page.locator('.st-row')).toHaveCount(4);
    await expect(row(page, 'Bench')).toHaveClass(/nested/);
    await page.getByLabel('Tier').selectOption('3');
    await expect(page.locator('.st-row')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Bench');
  });

  test('names follow the naming setting', async ({ page }) => {
    await useSettings(page, { naming: 'game' });
    await open(page);
    // the synthetic callouts have no separate game name, so the community name stays; the alias line is hidden for "game names only"
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect(selected(page)).toHaveText('A Ramp');
    await expect(page.locator('.st-alias')).toHaveCount(0);
  });

  test('never writes to the review log, and does not even create it', async ({ page }) => {
    await open(page);
    await page.keyboard.press(']');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('3');
    await page.locator('path.rg[aria-label^="Palace"]').click();
    await page.getByLabel('State').selectOption('seen');
    expect(await savedEvents(page)).toEqual([]);
    expect(await databaseNames(page)).not.toContain(DEMO_DB);
    expect(await databaseNames(page)).not.toContain('callouts');
  });

  test('with a log, it leaves the log exactly as it was', async ({ page }) => {
    const events = history(Date.now());
    await seedDemoLog(page, events);
    await open(page);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.st-row').first()).toBeVisible();
    const saved = await savedEvents(page);
    expect(saved.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
  });

  test('a map with no callouts says so, and an unknown map says that', async ({ page }) => {
    await page.goto('/#/study/de_mirage');
    await expect(page.getByRole('heading', { name: 'Nothing to study yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '#/map/de_mirage');
    await expectFits(page, 'study, a map without callouts');
    await page.goto('/#/study/de_nowhere');
    await expect(page.getByRole('heading', { name: 'No such map' })).toBeVisible();
    await expectFits(page, 'study, unknown map');
  });

  test('on a phone the three panes take turns', async ({ page }) => {
    await setViewport(page, [390, 844]);
    await page.goto(STUDY);
    await expect(page.locator('.st-photo')).toBeVisible();
    await expect(page.locator('.st-nav')).toBeHidden();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('.st-nav')).toBeVisible();
    await expect(page.locator('.st-photo')).toBeHidden();
    await row(page, 'T Spawn').click(); // choosing a row goes back to the picture
    await expect(page.locator('.st-photo')).toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('.st-map')).toBeVisible();
  });

  for (const size of VIEWPORTS) {
    test(`fits ${size[0]}x${size[1]}: first zone, a full zone with Hard mode on, a zone with long lists`, async ({ page }) => {
      await useSettings(page, { hardMode: { de_test: true } });
      await setViewport(page, size);
      await page.goto(STUDY);
      await expect(page.locator('.st-body')).toBeVisible();
      await settle(page);
      await expectFits(page, `${size.join('x')} study, first zone`);
      // zone A has four rows, one of them nested; on the small phones the list takes the slot
      await page.keyboard.press('PageDown');
      await page.keyboard.press('PageDown');
      await settle(page);
      await expectFits(page, `${size.join('x')} study, zone A`);
      if (size[0] <= 820 && size[1] > size[0] * 0.75) {
        await page.getByRole('button', { name: 'List', exact: true }).click();
        await settle(page);
        await expectFits(page, `${size.join('x')} study, list`);
        await page.getByRole('button', { name: 'Map', exact: true }).click();
        await settle(page);
        await expectFits(page, `${size.join('x')} study, map`);
      }
    });
  }
});

// ================================================================================================ Summary ==============

test.describe('Summary', () => {
  /** A finished session of 18 cards with three callouts moved up, as the Session screen would leave it. */
  const finished: LastSession = {
    mapId: 'de_test',
    at: 1_800_000_000_000,
    note: null,
    playable: 9,
    names: { 'test.palace': 'Palace', 'test.a-ramp': 'A Ramp', 'test.mid': 'Mid', 'test.connector': 'Connector', 'test.b-site': 'B Site', 'zzz.gone': 'Gone Place' },
    summary: {
      finished: true,
      answered: 18,
      correct: 15,
      totalMs: 18 * 2400,
      slowest: [
        { calloutId: 'test.palace', mode: 'name-mc', latencyMs: 6200 },
        { calloutId: 'zzz.gone', mode: 'pin', latencyMs: 5100 },
        { calloutId: 'test.a-ramp', mode: 'name-mc', latencyMs: 4300 },
      ],
      confusions: [
        { target: 'test.palace', chosen: 'test.a-ramp', count: 3 },
        { target: 'test.mid', chosen: 'test.connector', count: 2 },
        { target: 'test.b-site', chosen: 'test.mid', count: 1 },
        { target: 'test.connector', chosen: 'test.b-site', count: 1 },
      ],
      introduced: ['test.mid', 'test.a-ramp', 'test.palace', 'test.connector'],
      mastery: [
        { calloutId: 'test.mid', from: 'new', to: 'seen' },
        { calloutId: 'test.a-ramp', from: 'seen', to: 'learning' },
        { calloutId: 'test.palace', from: 'learning', to: 'familiar' },
        { calloutId: 'test.connector', from: 'new', to: 'learning' },
        { calloutId: 'test.b-site', from: 'new', to: 'seen' },
      ],
      endedBy: 'plan',
    },
  };
  /** Nothing moved up and nothing was mixed up: the map is drawn once, and the lists say so. */
  const steady: LastSession = {
    ...finished,
    summary: { ...finished.summary, answered: 6, correct: 6, totalMs: 6 * 1500, slowest: [], confusions: [], introduced: [], mastery: [], finished: false, endedBy: 'left' },
  };
  const nothingDue: LastSession = {
    ...finished,
    note: 'nothing-due',
    summary: { ...finished.summary, answered: 0, correct: 0, totalMs: 0, slowest: [], confusions: [], introduced: [], mastery: [] },
  };

  async function show(page: Page, session: LastSession | null, map = 'de_test'): Promise<void> {
    await page.goto('/#/progress'); // any screen: the hook is installed when the app loads
    await page.waitForFunction(() => (window as Hooked).__calloutsStudy !== undefined);
    await page.evaluate(
      ([s, id]) => {
        const hook = (window as Hooked).__calloutsStudy!;
        if (s) hook.setLastSession(s as LastSession);
        else hook.clearLastSession();
        location.hash = `#/summary/${id as string}`;
      },
      [session, map] as const,
    );
    await expect(page.locator('.sm')).toBeVisible();
  }

  test('shows the numbers of the session', async ({ page }) => {
    await show(page, finished);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('18 cards done');
    await expect(page.locator('.eyebrow')).toHaveText('Session complete');
    const stats = page.locator('.sm-head .stats');
    await expect(stats).toContainText('83% correct');
    await expect(stats).toContainText('15 of 18 right');
    await expect(stats).toContainText('2.4 s average');
    await expect(stats).toContainText('4 new');
  });

  test('lists the slowest, the new confusions and what moved up, with names through the naming setting or the recorded ones', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await show(page, finished);
    const slowest = page.getByRole('region', { name: 'Slowest' });
    await expect(slowest).toContainText('Palace');
    await expect(slowest).toContainText('6.2 s');
    await expect(slowest).toContainText('Gone Place'); // not on the map: the name the session recorded
    const mixed = page.getByRole('region', { name: 'New confusions' });
    await expect(mixed).toContainText('Palace for A Ramp');
    await expect(mixed).toContainText('3 times');
    await expect(mixed).toContainText('Mid for Connector');
    const moved = page.getByRole('region', { name: 'Moved up' });
    await expect(moved).toContainText('Palace');
    await expect(moved).toContainText('Learning → Familiar');
  });

  test('says how many rows it left out when they do not all fit', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await show(page, finished);
    // four confusions and five movers exist; at this height at most three of each are shown
    await expect(page.getByRole('region', { name: 'New confusions' }).getByRole('heading')).toContainText(/and \d+ more/);
    await expect(page.getByRole('region', { name: 'Moved up' }).getByRole('heading')).toContainText(/and \d+ more/);
  });

  test('draws the map before and after, with the callouts that moved emphasised on the after map', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await show(page, finished);
    await expect(page.getByRole('img', { name: /mastery before this session/i })).toBeVisible();
    await expect(page.getByRole('img', { name: /mastery after this session/i })).toBeVisible();
    await expect(page.locator('.sm-fig figcaption')).toHaveText(['Before', 'After']);
    await expect(page.getByLabel('Mastery states').locator('.mgl')).toHaveCount(6);
  });

  test('with nothing moved up it draws the map once and says so', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await show(page, steady);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('6 cards done');
    await expect(page.locator('.eyebrow')).toHaveText('Session ended early, everything is saved');
    await expect(page.locator('.sm-fig')).toHaveCount(1);
    await expect(page.locator('.sm-fig figcaption')).toContainText('Nothing moved up this session');
    await expect(page.getByRole('region', { name: 'Slowest' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'New confusions' })).toContainText('Nothing new this time');
    await expect(page.getByRole('region', { name: 'Moved up' })).toHaveCount(0);
  });

  test('"Another round" goes to a new session of the map and "Done" goes home', async ({ page }) => {
    await show(page, finished);
    await page.getByRole('button', { name: 'Another round' }).click();
    await expect(page).toHaveURL(/#\/session\/de_test$/);
    await show(page, finished);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/#\/(primer)?$/); // a first-time visitor is sent on to the primer by the Home screen
  });

  test('Tab reaches "Another round" before "Done", and Enter on it starts the next round', async ({ page }) => {
    await show(page, finished);
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    const seen: string[] = [];
    for (let i = 0; i < 12 && !seen.includes('Another round'); i++) {
      await page.keyboard.press('Tab');
      seen.push(await focused());
    }
    expect(seen.at(-1)).toBe('Another round');
    await page.keyboard.press('Tab');
    expect(await focused()).toBe('Done');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/session\/de_test$/);
  });

  test('a session that had nothing to do says why, with one button', async ({ page }) => {
    await show(page, nothingDue);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing to do');
    await expect(page.locator('.sm-notice p')).toContainText('Nothing was due');
    await expect(page.getByRole('button', { name: 'Another round' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('with no session since the page opened, it says there is nothing to summarise and offers a session', async ({ page }) => {
    await show(page, null);
    await expect(page.getByRole('heading', { name: 'Nothing to summarise' })).toBeVisible();
    await page.getByRole('button', { name: 'Start a session' }).click();
    await expect(page).toHaveURL(/#\/session\/de_test$/);
  });

  test("a session of another map is not shown for this one", async ({ page }) => {
    await show(page, { ...finished, mapId: 'de_mirage' });
    await expect(page.getByRole('heading', { name: 'Nothing to summarise' })).toBeVisible();
  });

  test('a map that does not exist says so', async ({ page }) => {
    await show(page, finished, 'de_nowhere');
    await expect(page.getByRole('heading', { name: 'No such map' })).toBeVisible();
  });

  test('reads the log without changing it', async ({ page }) => {
    const events = history(Date.now());
    await seedDemoLog(page, events);
    await show(page, finished);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('18 cards done');
    expect((await savedEvents(page)).map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
  });

  for (const size of VIEWPORTS) {
    test(`fits ${size[0]}x${size[1]}: a session with changes, one without, and an empty one`, async ({ page }) => {
      await setViewport(page, size);
      for (const [label, session] of [['with changes', finished], ['steady', steady], ['nothing to do', nothingDue], ['no session', null]] as const) {
        await show(page, session);
        await settle(page);
        await expectFits(page, `${size.join('x')} summary, ${label}`);
      }
    });
  }
});

// ================================================================================================ Progress =============

test.describe('Progress', () => {
  test('with an empty log it says so on every panel and still fits', async ({ page }) => {
    await page.goto('/#/progress');
    await expect(page.locator('.pg-totals')).toContainText('No answers yet');
    await expect(page.getByRole('link', { name: /Mirage/ })).toContainText('No callouts yet');
    await expect(page.locator('.pg-speed .pg-none')).toContainText('Nothing to show yet');
    await expect(page.locator('.pg-mixed .pg-none')).toContainText('Nothing mixed up twice yet');
    await expect(page.getByRole('img', { name: /No answers in the last 26 weeks/ })).toBeVisible();
    await expect(page.locator('.pg-cell[data-level="0"]').first()).toBeVisible();
    await expect(page.locator('.pg-cell:not([data-level="0"])')).toHaveCount(4); // the key's four shades; no day is shaded
    await expectFits(page, 'progress, empty log');
  });

  test('reading an empty log does not create the database', async ({ page }) => {
    await page.goto('/#/progress');
    await expect(page.locator('.pg-body')).toBeVisible();
    expect(await databaseNames(page)).not.toContain('callouts');
    expect(await databaseNames(page)).not.toContain(DEMO_DB);
  });

  test.describe('with a history', () => {
    let now = 0;
    test.beforeEach(async ({ page }) => {
      now = Date.now();
      await seedDemoLog(page, history(now));
      await page.goto('/#/progress');
      await expect(page.locator('.pg-grid')).toBeVisible();
    });

    test('opens on the development log when there is no real one, and labels it', async ({ page }) => {
      await expect(page.locator('.pg-totals .chip')).toHaveText('development data');
      await expect(page.getByRole('button', { name: 'Development' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('totals: answers, accuracy, days practised, callouts met', async ({ page }) => {
      const totals = page.locator('.pg-totals');
      await expect(totals).toContainText('9 answers');
      await expect(totals).toContainText('67% right');
      await expect(totals).toContainText('4 days practised');
      await expect(totals).toContainText('5 callouts met');
    });

    test('mastery by map: one row per map with its bar, percent and a link to the map', async ({ page }) => {
      const test_ = page.locator('.pg-map[data-map="de_test"]');
      await expect(test_).toBeVisible();
      await expect(test_).toHaveAttribute('href', '#/map/de_test');
      await expect(test_.locator('.pg-pct')).toHaveText(/^\d+%$/);
      await expect(test_.locator('.pg-bar .mgl').first()).toBeVisible();
      await expect(test_.getByRole('img')).toHaveAccessibleName(/Test: \d+% learned\./);
      await expect(test_).toContainText('Core');
      await test_.click();
      await expect(page).toHaveURL(/#\/map\/de_test$/);
    });

    test('mixed up most: pairs confused at least twice, not once', async ({ page }) => {
      const pairs = page.locator('.pg-pair');
      await expect(pairs).toHaveCount(1);
      await expect(pairs.first()).toContainText('A Ramp');
      await expect(pairs.first()).toContainText('Palace');
      await expect(pairs.first()).toContainText('2 times');
      await expect(page.locator('.pg-mixed')).not.toContainText('Connector'); // Mid for Connector happened once
    });

    test('speed: the median of this week and the change since the earliest week in view', async ({ page }) => {
      await expect(page.getByTestId('speed-now')).toHaveText('1.8 s');
      // 3.0 s forty days ago, 1.8 s now: five or six weeks apart, depending on the weekday
      await expect(page.locator('.pg-delta')).toHaveText(/1\.2 s faster than [56] weeks ago/);
      // two weeks with right answers (40 days ago, this one) plus possibly yesterday's, which is the same week or the one before
      const dots = await page.locator('.pg-chart circle.dot').count();
      expect(dots === 2 || dots === 3).toBe(true);
      await expect(page.locator('.pg-chart circle.dot.last')).toHaveCount(1);
      // a line joins only weeks that follow each other: yesterday's week and this one, when they differ; 40 days back stands alone
      await expect(page.locator('.pg-chart path.ln')).toHaveCount(dots === 3 ? 1 : 0);
    });

    test('heat-grid: a square for each day, newest at the right, shaded by answers', async ({ page }) => {
      const today = dateKey(startOfDay(now));
      const yesterday = dateKey(startOfDay(now) - DAY);
      await expect(page.locator('.pg-grid')).toHaveAttribute('data-total', '9');
      await expect(page.locator(`.pg-cell[data-date="${today}"]`)).toHaveAttribute('data-answers', '4');
      await expect(page.locator(`.pg-cell[data-date="${today}"]`)).toHaveAttribute('data-level', '4');
      await expect(page.locator(`.pg-cell[data-date="${yesterday}"]`)).toHaveAttribute('data-answers', '2');
      await expect(page.locator(`.pg-cell[data-date="${yesterday}"]`)).toHaveAttribute('data-level', '2');
      await expect(page.locator('.pg-grid .pg-cell:not([data-level="0"])')).toHaveCount(4);
      await expect(page.getByRole('img', { name: /9 answers on 4 days in the last 26 weeks, at most 4 in a day/ })).toBeVisible();
      // the newest square is today's, in the last column
      const last = page.locator('.pg-grid .pg-cell').last();
      await expect(last).toHaveAttribute('data-date', today);
      // a day names its count for a pointer
      await expect(page.locator(`.pg-cell[data-date="${today}"]`)).toHaveAttribute('title', /: 4 answers$/);
    });

    test('"Your log" is the real one, which is empty here', async ({ page }) => {
      await page.getByRole('button', { name: 'Your log' }).click();
      await expect(page.locator('.pg-totals')).toContainText('No answers yet');
      await expect(page.locator('.pg-totals .chip')).toHaveCount(0);
      await expect(page.locator('.pg-map[data-map="de_mirage"]')).toContainText('No callouts yet');
      await expect(page.locator('.pg-map[data-map="de_test"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Development' }).click();
      await expect(page.locator('.pg-totals')).toContainText('9 answers');
    });

    test('never writes to the log', async ({ page }) => {
      const before = (await savedEvents(page)).map((e) => e.id).sort();
      await page.getByRole('button', { name: 'Your log' }).click();
      await page.getByRole('button', { name: 'Development' }).click();
      expect((await savedEvents(page)).map((e) => e.id).sort()).toEqual(before);
      expect(await databaseNames(page)).not.toContain('callouts');
    });

    for (const size of VIEWPORTS) {
      test(`fits ${size[0]}x${size[1]}: every panel`, async ({ page }) => {
        await setViewport(page, size);
        await page.goto('/#/progress');
        await expect(page.locator('.pg-body')).toBeVisible();
        await settle(page);
        await expectFits(page, `${size.join('x')} progress`);
        if (size[0] <= 820 && size[1] > size[0] * 0.75) {
          for (const tab of ['Mixed up', 'Speed', 'Reviews', 'Maps']) {
            await page.getByRole('button', { name: tab, exact: true }).click();
            await settle(page);
            await expectFits(page, `${size.join('x')} progress, ${tab}`);
          }
        }
      });
    }
  });

  test('pages the confusion pairs when they do not all fit, and never scrolls', async ({ page }) => {
    // every pair of the eight synthetic callouts, each mixed up twice: 28 pairs
    const ids = ['t-spawn', 'mid', 'a-ramp', 'a-site', 'palace', 'connector', 'b-site', 'b-apps'].map((s) => `test.${s}`);
    const events: ReviewEvent[] = [];
    let n = 0;
    const base = startOfDay(Date.now());
    for (const a of ids) for (const b of ids) if (a < b) for (let k = 0; k < 2; k++) events.push(answer((n += 1), base + n * 1000, a, false, 4000, b));
    await seedDemoLog(page, events);
    await setViewport(page, [640, 360]);
    await page.goto('/#/progress');
    await expect(page.locator('.pg-pair').first()).toBeVisible();
    const first = await page.locator('.pg-pair').first().getAttribute('data-pair');
    const shown = await page.locator('.pg-pair').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(28);
    const pager = page.locator('.pg-mixed .pg-foot .nums');
    await expect(pager).toHaveText(new RegExp(`^1 / ${Math.ceil(28 / shown)}$`));
    await page.getByRole('button', { name: 'Next page of pairs' }).click();
    await expect(pager).toHaveText(new RegExp(`^2 / ${Math.ceil(28 / shown)}$`));
    expect(await page.locator('.pg-pair').first().getAttribute('data-pair')).not.toBe(first);
    await page.getByRole('button', { name: 'Previous page of pairs' }).click();
    expect(await page.locator('.pg-pair').first().getAttribute('data-pair')).toBe(first);
    await settle(page);
    await expectFits(page, 'progress, many pairs at 640x360');
  });

  test('a phone upright shows one panel at a time', async ({ page }) => {
    await setViewport(page, [360, 640]);
    await page.goto('/#/progress');
    await expect(page.locator('.pg-maps')).toBeVisible();
    await expect(page.locator('.pg-heat')).toBeHidden();
    await page.getByRole('button', { name: 'Reviews', exact: true }).click();
    await expect(page.locator('.pg-heat')).toBeVisible();
    await expect(page.locator('.pg-maps')).toBeHidden();
  });

  test('every panel of an empty log fits every viewport', async ({ page }) => {
    for (const size of VIEWPORTS) {
      await setViewport(page, size);
      await page.goto('/#/progress');
      await expect(page.locator('.pg-body')).toBeVisible();
      await settle(page);
      await expectFits(page, `${size.join('x')} progress, empty`);
    }
  });
});

// ================================================================================================== Primer =============

test.describe('Primer', () => {
  const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as { primerSeen?: boolean } | null, SETTINGS_KEY);

  test('is one screen that explains a callout, the spawns, the sites and the radar, and names no map', async ({ page }) => {
    await page.goto('/#/primer');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How callouts work');
    const titles = page.locator('.pr-card h2');
    await expect(titles).toHaveText(['A callout is a name for a place', 'Two teams, two spawns', 'Two bombsites, A and B', 'The map never turns']);
    await expect(page.locator('.pr-body')).toContainText('North is always up');
    // map-neutral: nothing of any particular map (SCOPE §4.11, the content is each map's own)
    const text = (await page.locator('.pr-body').textContent()) ?? '';
    expect(text).not.toMatch(/mirage|inferno|dust|nuke|ancient|anubis|overpass|vertigo|train/i);
  });

  test('"Got it" marks the primer seen and goes to the start', async ({ page }) => {
    await page.goto('/#/primer');
    expect(await stored(page)).toBeNull();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect((await stored(page))?.primerSeen).toBe(true);
    await page.waitForTimeout(300); // the start does not send a learner who has seen it back here
    await expect(page).toHaveURL(/#\/$/);
  });

  test('"Skip" does the same', async ({ page }) => {
    await page.goto('/#/primer');
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect((await stored(page))?.primerSeen).toBe(true);
  });

  test('Enter is "Got it" and Escape is "Skip", with no mouse', async ({ page }) => {
    await page.goto('/#/primer');
    await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/$/);
    expect((await stored(page))?.primerSeen).toBe(true);

    await page.evaluate((key) => localStorage.removeItem(key), SETTINGS_KEY);
    await page.goto('/#/primer');
    await page.reload();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/$/);
    expect((await stored(page))?.primerSeen).toBe(true);
  });

  test('Back from the start does not return to the primer', async ({ page }) => {
    await page.goto('/#/progress');
    await page.evaluate(() => (location.hash = '#/primer'));
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/progress$/);
  });

  test('read again after it has been seen, it has nothing to skip', async ({ page }) => {
    await useSettings(page, { primerSeen: true });
    await page.goto('/#/primer');
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page).toHaveURL(/#\/$/);
    expect((await stored(page))?.primerSeen).toBe(true);
  });

  test('keeps the other settings it finds', async ({ page }) => {
    await useSettings(page, { newPerSession: 6, naming: 'community' });
    await page.goto('/#/primer');
    await page.getByRole('button', { name: 'Skip' }).click();
    const settings = (await stored(page)) as Record<string, unknown>;
    expect(settings['primerSeen']).toBe(true);
    expect(settings['newPerSession']).toBe(6);
    expect(settings['naming']).toBe('community');
  });

  for (const size of VIEWPORTS) {
    test(`fits ${size[0]}x${size[1]}`, async ({ page }) => {
      await setViewport(page, size);
      await page.goto('/#/primer');
      await expect(page.locator('.pr-cards')).toBeVisible();
      await settle(page);
      await expectFits(page, `${size.join('x')} primer`);
    });
  }
});
