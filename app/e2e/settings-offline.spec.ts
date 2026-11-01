// Settings, data and offline (package D), driven in the browser: every tab fits every window, the keyboard reaches
// everything, choices survive a reload, the reduced-motion override changes real computed styles, a backup downloads
// with the right contents and imports with the right counts, one map's progress can be reset without touching another's,
// and a visited app opens and runs a session with no connection.
//
// Nothing here touches the real review log (`callouts`): the screen is opened with `?log=demo`, which points export and
// import at the synthetic map's database (`callouts-demo`), and a test fails if the real one ever appears.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildExport, EXPORT_FORMAT, EXPORT_VERSION, parseImport, serializeExport } from '../src/core/exportfile';
import type { ReviewEvent } from '../src/core/log';
import { DEMO_DB, expectFits, play, savedEvents } from './support';

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

const PORT = Number(process.env['E2E_PORT'] ?? 4173);
const BUILD_ASSETS = new URL(`../dist-e2e-${PORT}/assets/`, import.meta.url);
const SETTINGS_KEY = 'callouts.settings';
const T0 = Date.parse('2026-03-01T10:00:00Z');

// ---- helpers ----

const intro = (id: string, callout: string, ts: number): ReviewEvent => ({ kind: 'intro', id, ts, callout });
const answered = (id: string, callout: string, ts: number, correct = true): ReviewEvent => ({
  kind: 'answer',
  id,
  ts,
  callout,
  mode: 'name-mc',
  correct,
  latencyMs: 1800,
  hint: false,
  rating: correct ? 3 : 1,
  chosen: null,
});

/** Four events of the synthetic map, one of a map whose id starts alike, and two of Mirage, all in the demo log. */
const SEED: ReviewEvent[] = [
  intro('s1', 'test.mid', T0),
  answered('s2', 'test.mid', T0 + 1000),
  intro('s3', 'test.a-ramp', T0 + 2000),
  answered('s4', 'test.a-ramp', T0 + 3000, false),
  intro('s5', 'test2.mid', T0 + 4000), // `test.` must not take `test2.` with it
  intro('s6', 'mirage.palace', T0 + 5000),
  answered('s7', 'mirage.palace', T0 + 6000),
];

/** The settings screen on the demo log. Tabs are then changed by clicking: a hash change alone does not reload the screen. */
async function openSettings(page: Page, tab = 'session', part?: string): Promise<void> {
  await page.goto(`/?log=demo#/settings?tab=${tab}${part ? `&part=${part}` : ''}`);
  await expect(page.getByRole('tabpanel')).toBeVisible();
}

const tab = (page: Page, id: 'session' | 'hard' | 'naming' | 'display' | 'keys' | 'data') => page.locator(`#set-tab-${id}`);
const part = (page: Page, name: 'backup' | 'progress' | 'offline') => page.getByRole('radio', { name, exact: true });

async function stored(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>, SETTINGS_KEY);
}

async function seedEvents(page: Page, events: ReviewEvent[], db = DEMO_DB): Promise<void> {
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
    [db, events] as const,
  );
}

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
}

/** A browser-readable backup file with the given rows, as the file picker would hand it over. */
function backupFile(rows: unknown[], extra: Record<string, unknown> = {}, name = 'backup.json') {
  const base = buildExport([], { naming: 'game' }, T0);
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...base, events: rows, ...extra })) };
}

const pickFile = (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) => page.getByLabel('Backup file').setInputFiles(file);

/**
 * Nothing inside a block may run over the block's edge. `expectFits` only knows the window; a row of buttons that is
 * wider than its column still fits the window and then covers the column next to it.
 */
async function expectContained(page: Page, context: string): Promise<void> {
  const out = await page.evaluate(() => {
    const bad: string[] = [];
    for (const block of document.querySelectorAll('.set-block, .set-data > .set-seg')) {
      const b = block.getBoundingClientRect();
      for (const e of block.querySelectorAll('*')) {
        if (e.closest('.sr-only') || e.tagName === 'INPUT') continue; // a hidden input covers its label, and that is its job
        const r = e.getBoundingClientRect();
        if (r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1)) bad.push(`${e.tagName.toLowerCase()}.${e.getAttribute('class') ?? ''} in ${block.className}`);
      }
    }
    return bad.slice(0, 8);
  });
  expect(out, `${context}: something runs over the edge of its block`).toEqual([]);
}

/** The screen fits the window, and nothing in it runs over its neighbour. */
async function expectSettled(page: Page, context: string): Promise<void> {
  await expectFits(page, context);
  await expectContained(page, context);
}

/** Give the offline list one more map, with pictures that are real files of the app (the real maps have none on the web yet). */
async function addPack(page: Page, files: string[]): Promise<void> {
  await page.evaluate((list) => {
    (window as unknown as { __calloutsPacks: { addTarget(t: unknown): void } }).__calloutsPacks.addTarget({
      mapId: 'de_pack',
      name: 'Pack test',
      urls: list.map((f) => new URL(`/icons/${f}`, location.href).href),
      inline: 0,
    });
  }, files);
}

/** Maps are two to a page in the offline list: the third one is on the next. */
const showPack = async (page: Page) => page.getByRole('button', { name: 'Next maps' }).click();

/** The label around a switch, which holds its note ("3 hard spots") as well as its name. */
const switchRow = (page: Page, name: RegExp | string) => page.getByRole('switch', { name }).locator('xpath=..');

/** The failures a visitor would see in the console. Collected for the whole test and checked at the end. */
function watchErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return () => errors;
}

// ---- every tab fits every window ----

test.describe('fit', () => {
  for (const [w, h] of VIEWPORTS) {
    test(`every tab and part fits at ${w}x${h}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await openSettings(page);
      await seedEvents(page, SEED);
      await addPack(page, ['icon-192.png', 'icon-512.png', 'missing.png']); // a third map, so the offline list has a second page

      for (const id of ['session', 'hard', 'naming', 'display', 'keys', 'data'] as const) {
        await tab(page, id).click();
        await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true');
        await expectSettled(page, `${w}x${h} ${id}`);
      }

      await tab(page, 'data').click();
      await part(page, 'progress').click();
      await expect(page.getByText('Test (development)').first()).toBeVisible();
      await expectSettled(page, `${w}x${h} data/progress`);

      await page.getByRole('button', { name: 'Reset Test (development)' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectSettled(page, `${w}x${h} data/progress, the question`);
      await page.getByRole('button', { name: 'Keep it' }).click();

      await part(page, 'offline').click();
      await expect(page.locator('[data-map="de_test"]')).toBeVisible();
      await expectSettled(page, `${w}x${h} data/offline`);
      await page.getByRole('button', { name: 'Next maps' }).click();
      await expect(page.locator('[data-map="de_pack"]')).toBeVisible();
      await expectSettled(page, `${w}x${h} data/offline, second page`);

      await part(page, 'backup').click();
      await expectSettled(page, `${w}x${h} data/backup`);

      // an import waiting for a click: long file name, every count, settings on offer, a conflict
      const rows = [...SEED.slice(0, 2), { ...SEED[2], ts: T0 + 99 }, ...Array.from({ length: 30 }, (_, i) => intro(`n${i}`, 'test.mid', T0 + 10_000 + i)), { kind: 'nope' }, 'text'];
      await pickFile(page, backupFile(rows, { settings: { naming: 'game', newPerSession: 99 } }, 'callouts-backup-2026-11-02-from-my-other-computer-with-a-long-name.json'));
      await expect(page.getByText('30 new')).toBeVisible();
      await expectSettled(page, `${w}x${h} data/backup, an import waiting`);

      await page.getByRole('button', { name: 'Reset settings' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectSettled(page, `${w}x${h} reset settings, the question`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);

      expect(errors()).toEqual([]);
    });
  }
});

// ---- the keyboard ----

test.describe('keyboard', () => {
  test('the tabs move with the arrow keys, Home and End, without adding history entries', async ({ page }) => {
    await openSettings(page);
    const history = await page.evaluate(() => window.history.length);
    await tab(page, 'session').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'hard')).toBeFocused();
    await expect(tab(page, 'hard')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('Hard mode by default');
    expect(page.url()).toContain('tab=hard');
    await page.keyboard.press('End');
    await expect(tab(page, 'data')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(tab(page, 'session')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wraps back
    await expect(tab(page, 'data')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab(page, 'session')).toBeFocused();
    expect(await page.evaluate(() => window.history.length)).toBe(history);
    // only the open tab is a stop of its own
    expect(await page.locator('[role="tab"][tabindex="0"]').count()).toBe(1);
  });

  test('Tab goes from the bar to the open tab and on to its first control', async ({ page }) => {
    await openSettings(page);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return (el?.getAttribute('aria-label') ?? el?.closest('label')?.textContent ?? el?.textContent ?? '').trim().replace(/\s+/g, ' ');
        }),
      );
    }
    expect(order[0]).toBe('callouts, back to the start');
    expect(order[1]).toBe('Reset settings');
    expect(order[2]).toMatch(/^Done/);
    expect(order[3]).toBe('Session');
    expect(order[4]).toBe('20 cards'); // the checked radio is the one tab lands on
  });

  test('session length, new per session, recall and gentle start are all set with keys alone', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('radio', { name: '20 cards' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: '10 min' })).toBeChecked();
    expect(await stored(page)).toMatchObject({ sessionMinutes: 10, sessionCards: null });

    await page.getByRole('radio', { name: 'Until I stop' }).focus();
    await page.keyboard.press('Space');
    expect(await stored(page)).toMatchObject({ sessionMinutes: null, sessionCards: null });

    await page.getByRole('radio', { name: '4', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '6', exact: true })).toBeChecked();
    expect(await stored(page)).toMatchObject({ newPerSession: 6 });

    const slider = page.getByRole('slider', { name: 'Target recall' });
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await stored(page)).toMatchObject({ retention: 0.93 });
    await expect(page.getByRole('tabpanel')).toContainText('93%');
    await page.keyboard.press('Home');
    expect(await stored(page)).toMatchObject({ retention: 0.85 });
    await page.keyboard.press('End');
    expect(await stored(page)).toMatchObject({ retention: 0.95 });

    const gentle = page.getByRole('switch', { name: 'Three choices at first' });
    await gentle.focus();
    await page.keyboard.press('Space');
    await expect(gentle).not.toBeChecked();
    expect(await stored(page)).toMatchObject({ gentleStart: false });
    await page.keyboard.press('Space');
    expect(await stored(page)).toMatchObject({ gentleStart: true });
  });

  test('"Reset settings" asks first, the safe answer has the focus, and Escape closes the question before it leaves the screen', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('radio', { name: '7', exact: true }).check();
    const reset = page.getByRole('button', { name: 'Reset settings' });
    await reset.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep them' })).toBeFocused();
    await expect(page.locator('main')).toHaveAttribute('inert', '');

    await page.keyboard.press('Enter'); // on "Keep them"
    await expect(dialog).toHaveCount(0);
    await expect(reset).toBeFocused(); // back where it was
    expect((await stored(page))['newPerSession']).toBe(7);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toContain('#/settings'); // still here
    expect((await stored(page))['newPerSession']).toBe(7);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Reset settings' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    expect((await stored(page))['newPerSession']).toBe(4);
    await expect(page.getByRole('radio', { name: '4', exact: true })).toBeChecked();
  });

  test('Escape leaves settings, and so does "Done"', async ({ page }) => {
    // a learner who has seen the primer: the start screen sends everyone else there first
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ primerSeen: true })), SETTINGS_KEY);
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/$/);
    await openSettings(page);
    await page.getByRole('link', { name: /^Done/ }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('the Data parts, a map reset and an import are reachable by keyboard', async ({ page }) => {
    await openSettings(page, 'data');
    await seedEvents(page, SEED);
    await part(page, 'backup').focus();
    await page.keyboard.press('ArrowRight');
    await expect(part(page, 'progress')).toBeChecked();
    await expect(page.getByText('Reset progress for one map')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Test (development)' })).toBeEnabled();
    await page.getByRole('button', { name: 'Reset Test (development)' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toContainText('Test (development)');
    await page.keyboard.press('Escape');
    expect((await savedEvents(page)).length).toBe(SEED.length);
    await part(page, 'progress').focus(); // closing the question gave the focus back to the button that opened it
    await page.keyboard.press('ArrowRight');
    await expect(part(page, 'offline')).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(part(page, 'backup')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Choose a backup file' })).toBeVisible();
  });
});

// ---- choices are kept ----

test.describe('persistence', () => {
  test('every setting is still there after a reload, and the tab and part are in the address', async ({ page }) => {
    const errors = watchErrors(page);
    await openSettings(page);
    await page.getByRole('radio', { name: '5 min' }).check();
    await page.getByRole('radio', { name: '2', exact: true }).check();
    await page.getByRole('slider', { name: 'Target recall' }).fill('88');
    await page.getByRole('switch', { name: 'Three choices at first' }).uncheck();

    await tab(page, 'hard').click();
    await page.getByRole('switch', { name: /^Hard mode by default/ }).check();
    await page.getByRole('switch', { name: /^Test \(development\)/ }).uncheck(); // a map's own setting beats the default
    await tab(page, 'naming').click();
    await page.getByRole('radio', { name: /^Game names only/ }).check();
    await tab(page, 'display').click();
    await page.getByRole('switch', { name: /^Sound/ }).check();
    await page.getByRole('radio', { name: 'Reduce' }).check();

    expect(await stored(page)).toMatchObject({
      sessionMinutes: 5,
      sessionCards: null,
      newPerSession: 2,
      retention: 0.88,
      gentleStart: false,
      hardModeDefault: true,
      hardMode: { de_test: false },
      naming: 'game',
      sound: true,
      reducedMotion: 'on',
    });

    await tab(page, 'data').click();
    await part(page, 'offline').click();
    await page.reload();
    await expect(tab(page, 'data')).toHaveAttribute('aria-selected', 'true');
    await expect(part(page, 'offline')).toBeChecked();
    expect(page.url()).toContain('tab=data&part=offline');

    await tab(page, 'session').click();
    await expect(page.getByRole('radio', { name: '5 min' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '2', exact: true })).toBeChecked();
    await expect(page.getByRole('slider', { name: 'Target recall' })).toHaveValue('88');
    await expect(page.getByRole('switch', { name: 'Three choices at first' })).not.toBeChecked();
    await tab(page, 'hard').click();
    await expect(page.getByRole('switch', { name: /^Hard mode by default/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /^Test \(development\)/ })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: /^Mirage/ })).toBeChecked(); // follows the default
    await tab(page, 'naming').click();
    await expect(page.getByRole('radio', { name: /^Game names only/ })).toBeChecked();
    await tab(page, 'display').click();
    await expect(page.getByRole('switch', { name: /^Sound/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Reduce' })).toBeChecked();
    expect(errors()).toEqual([]);
  });

  test('"Reset settings" puts every preference back and the screen shows it', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('radio', { name: '5 min' }).check();
    await tab(page, 'naming').click();
    await page.getByRole('radio', { name: /^Community names only/ }).check();
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), primerSeen: true })), SETTINGS_KEY);
    await page.reload();
    await page.getByRole('button', { name: 'Reset settings' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset settings' }).click();
    expect(await stored(page)).toMatchObject({ sessionMinutes: null, sessionCards: 20, naming: 'both', primerSeen: true });
    await expect(page.getByRole('radio', { name: /^Both names/ })).toBeChecked();
    await tab(page, 'session').click();
    await expect(page.getByRole('radio', { name: '20 cards' })).toBeChecked();
  });

  test('a stored value out of range does not reset the others', async ({ page }) => {
    await page.goto('/?log=demo');
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ naming: 'game', newPerSession: 99, retention: 0.93 })), SETTINGS_KEY);
    await openSettings(page);
    await page.reload();
    await expect(page.getByRole('radio', { name: '4', exact: true })).toBeChecked(); // the default for the bad one
    await expect(page.getByRole('slider', { name: 'Target recall' })).toHaveValue('93');
    await tab(page, 'naming').click();
    await expect(page.getByRole('radio', { name: /^Game names only/ })).toBeChecked();
  });
});

// ---- screens that explain themselves ----

test.describe('what each tab shows', () => {
  test('naming: each choice shows what it does with a callout the game and the community call differently', async ({ page }) => {
    await openSettings(page, 'naming');
    const both = page.getByRole('radio', { name: /^Both names/ });
    await expect(both).toBeChecked();
    await expect(page.getByRole('tabpanel')).toContainText('Short, the game calls it ShortStairs');
    await page.getByRole('radio', { name: /^Community names only/ }).check();
    expect(await stored(page)).toMatchObject({ naming: 'community' });
    await page.getByRole('radio', { name: /^Game names only/ }).check();
    expect(await stored(page)).toMatchObject({ naming: 'game' });
    await expect(page.locator('.set-pick-example').nth(2)).toHaveText('ShortStairs');
  });

  test('hard mode: a default and one switch per map, with the number of hard spots', async ({ page }) => {
    await openSettings(page, 'hard');
    await expect(switchRow(page, /^Mirage/)).toContainText('no hard spots yet');
    const test = page.getByRole('switch', { name: /^Test \(development\)/ });
    await expect(test).not.toBeChecked();
    await test.check();
    expect(await stored(page)).toMatchObject({ hardMode: { de_test: true } });
    await page.getByRole('switch', { name: /^Hard mode by default/ }).check();
    expect(await stored(page)).toMatchObject({ hardModeDefault: true, hardMode: { de_test: true } });
  });

  test('display: sound is stored and says there are no sounds yet; the primer can be opened again', async ({ page }) => {
    await openSettings(page, 'display');
    const sound = page.getByRole('switch', { name: /^Sound/ });
    await expect(switchRow(page, /^Sound/)).toContainText('no sounds yet');
    await sound.check();
    expect(await stored(page)).toMatchObject({ sound: true });
    await page.getByRole('link', { name: 'Show the primer again' }).click();
    await expect(page).toHaveURL(/#\/primer$/);
  });

  test('keys: the key map lists what the session, the map and settings answer to', async ({ page }) => {
    await openSettings(page, 'keys');
    const panel = page.getByRole('tabpanel');
    for (const text of ['In a session', 'On a map', 'In settings', 'Choose that answer', 'Hint', 'Skip', 'End the session', 'Move between regions', 'Zoom in', 'Switch tabs']) {
      await expect(panel).toContainText(text);
    }
  });
});

// ---- reduced motion really changes the page ----

test.describe('reduced motion', () => {
  const transition = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('.bar .btn') as Element).transitionDuration);
  const motion = (page: Page) => page.evaluate(() => document.documentElement.dataset['motion']);
  const stops = (value: string) => value.split(',').every((v) => parseFloat(v) === 0);

  test('"like my device" follows the device in both directions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openSettings(page, 'display');
    expect(await motion(page)).toBe('system');
    expect(stops(await transition(page))).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(stops(await transition(page))).toBe(true);
  });

  test('"Reduce" stops transitions on a device that asks for none of that, on every screen, and survives a reload', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openSettings(page, 'display');
    await page.getByRole('radio', { name: 'Reduce' }).check();
    expect(await motion(page)).toBe('reduce');
    expect(stops(await transition(page))).toBe(true);
    await page.reload();
    expect(await motion(page)).toBe('reduce');
    await page.goto('/?seed=1#/session/de_test'); // another screen, a fresh load
    await expect(page.locator('.app')).toHaveCount(1);
    expect(await motion(page)).toBe('reduce');
    expect(stops(await page.evaluate(() => getComputedStyle(document.querySelector('.btn') ?? document.body).transitionDuration))).toBe(true);
  });

  test('"Full" keeps motion on a device that asks for less', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSettings(page, 'display');
    expect(stops(await transition(page))).toBe(true);
    await page.getByRole('radio', { name: 'Full' }).check();
    expect(await motion(page)).toBe('full');
    expect(stops(await transition(page))).toBe(false);
  });

  test('going back to "like my device" hands the decision back', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openSettings(page, 'display');
    await page.getByRole('radio', { name: 'Reduce' }).check();
    await page.getByRole('radio', { name: 'Like my device' }).check();
    expect(await motion(page)).toBe('system');
    expect(stops(await transition(page))).toBe(false);
  });
});

// ---- export ----

test.describe('export', () => {
  test('downloads one versioned file with every event and the settings, and says what it saved', async ({ page }) => {
    await openSettings(page, 'data');
    await seedEvents(page, SEED);
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ naming: 'game', newPerSession: 6 })), SETTINGS_KEY);
    await page.reload();
    await expect(page.getByTestId('log-count')).toHaveText('7 events');
    await expect(page.locator('.chip.warn')).toHaveText('development log');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^callouts-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const text = readFileSync(path, 'utf8');

    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION });
    expect(Date.now() - Date.parse(String(raw['exportedAt']))).toBeLessThan(60_000);

    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.invalid).toBe(0);
    expect(parsed.events).toEqual([...SEED].sort((a, b) => a.ts - b.ts)); // every event, nothing added, oldest first
    expect(parsed.settings).toMatchObject({ naming: 'game', newPerSession: 6 });
    await expect(page.getByRole('status').filter({ hasText: 'Downloaded 7 events' })).toContainText(download.suggestedFilename());
  });

  test('an empty log exports an empty, valid file, and the real log is never created by looking at it', async ({ page }) => {
    await page.goto('/#/settings?tab=data'); // the real log, which does not exist yet
    await expect(page.getByRole('button', { name: 'Download backup' })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const parsed = parseImport(readFileSync(await download.path(), 'utf8'));
    expect(parsed).toMatchObject({ ok: true, events: [], invalid: 0 });
    await part(page, 'progress').click();
    await expect(page.getByRole('button', { name: 'Reset Mirage' })).toBeDisabled();
    expect(await databaseNames(page)).not.toContain('callouts');
  });
});

// ---- import ----

test.describe('import', () => {
  test('shows how many are new, already here and invalid, waits for a click, then merges and can be repeated', async ({ page }) => {
    const errors = watchErrors(page);
    await openSettings(page, 'data');
    const have = SEED.slice(0, 3);
    await seedEvents(page, have);
    await page.reload();

    const fresh = [intro('n1', 'test.mid', T0 + 10_000), answered('n2', 'test.mid', T0 + 11_000), intro('n3', 'test.a-ramp', T0 + 12_000)];
    // two the log has (one of them changed), one repeated inside the file, two that are not events, three new
    const changed = { ...have[1], correct: false, rating: 1 } as ReviewEvent;
    const file = backupFile([have[0], changed, ...fresh, fresh[0], { kind: 'nope', id: 'x' }, 'text']);
    await pickFile(page, file);

    const preview = page.getByRole('status').filter({ hasText: 'already here' });
    await expect(preview).toContainText('3 new, 3 already here, 2 invalid');
    await expect(page.getByText('1 event differs from yours; yours are kept')).toBeVisible();
    expect((await savedEvents(page)).length).toBe(3); // nothing is written before the click

    await page.getByRole('button', { name: 'Merge 3 events' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Added 3 events' })).toContainText('Added 3 events. 3 already here, 2 invalid, left out.');
    const after = await savedEvents(page);
    expect(after.map((e) => e.id).sort()).toEqual(['n1', 'n2', 'n3', 's1', 's2', 's3']);
    expect(after.find((e) => e.id === 's2')).toEqual(have[1]); // the stored event won
    await expect(page.getByTestId('log-count')).toHaveText('6 events');

    // the same file again: nothing is new, there is nothing to merge, and it can still be chosen
    await pickFile(page, file);
    await expect(preview).toContainText('0 new, 6 already here, 2 invalid');
    await expect(page.getByRole('button', { name: 'Nothing new' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Choose a backup file' })).toBeVisible();
    expect((await savedEvents(page)).length).toBe(6);

    expect(await databaseNames(page)).not.toContain('callouts');
    expect(errors()).toEqual([]);
  });

  test('takes the settings in the file only when asked, and only the valid ones', async ({ page }) => {
    await openSettings(page, 'data');
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ naming: 'both', newPerSession: 5 })), SETTINGS_KEY);
    await page.reload();
    const file = backupFile([intro('a1', 'test.mid', T0)], { settings: { naming: 'game', newPerSession: 99, retention: 0.92, fromTheFuture: true } });

    await pickFile(page, file);
    await expect(page.getByText('1 setting in the file could not be used')).toBeVisible();
    await page.getByRole('button', { name: 'Merge 1 event' }).click();
    expect(await stored(page)).toMatchObject({ naming: 'both', newPerSession: 5 }); // not asked for: not taken

    await pickFile(page, backupFile([intro('a2', 'test.mid', T0 + 1)], { settings: { naming: 'game', newPerSession: 99, retention: 0.92 } }));
    await page.getByRole('switch', { name: 'Also use its settings' }).check();
    await page.getByRole('button', { name: 'Merge 1 event' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'and the settings from the file' })).toBeVisible();
    expect(await stored(page)).toMatchObject({ naming: 'game', retention: 0.92, newPerSession: 5 }); // the invalid value was left out
  });

  test('cancelling leaves everything as it was', async ({ page }) => {
    await openSettings(page, 'data');
    await seedEvents(page, SEED.slice(0, 1));
    await pickFile(page, backupFile([intro('c1', 'test.mid', T0 + 5)], { settings: { naming: 'game' } }));
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await savedEvents(page)).map((e) => e.id)).toEqual(['s1']);
    expect((await stored(page))['naming']).toBeUndefined();
  });

  test('says plainly what is wrong with a file that is not a backup, and writes nothing', async ({ page }) => {
    await openSettings(page, 'data');
    const bad: [string, { name: string; mimeType: string; buffer: Buffer }, RegExp][] = [
      ['empty', { name: 'e.json', mimeType: 'application/json', buffer: Buffer.from('') }, /file is empty/],
      ['not JSON', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('this is not json') }, /not JSON/],
      ['other JSON', { name: 'o.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') }, /not a Callouts backup/],
      ['newer version', { name: 'n.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, events: [] })) }, /newer version of Callouts/],
    ];
    for (const [label, file, message] of bad) {
      await pickFile(page, file);
      await expect(page.getByRole('alert'), label).toContainText(message);
      await expect(page.getByRole('button', { name: /^Merge|Nothing new/ }), label).toHaveCount(0);
    }
    expect(await savedEvents(page)).toEqual([]);
    expect(await databaseNames(page)).not.toContain('callouts');
  });

  test('a backup made by "Download backup" imports into an empty log with every event new', async ({ page }) => {
    await openSettings(page, 'data');
    await seedEvents(page, SEED);
    await page.reload();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const text = readFileSync(await download.path());

    await page.evaluate((name) => indexedDB.deleteDatabase(name), DEMO_DB);
    await page.reload();
    await expect(page.getByTestId('log-count')).toHaveText('0 events');
    await pickFile(page, { name: download.suggestedFilename(), mimeType: 'application/json', buffer: text });
    await expect(page.getByRole('status').filter({ hasText: 'already here' })).toContainText('7 new, 0 already here, 0 invalid');
    await page.getByRole('button', { name: 'Merge 7 events' }).click();
    expect((await savedEvents(page)).map((e) => e.id).sort()).toEqual(SEED.map((e) => e.id).sort());
  });
});

// ---- reset one map ----

test.describe('reset progress', () => {
  test('names the map, asks first, deletes that map alone, and leaves other maps, look-alike ids and settings', async ({ page }) => {
    await openSettings(page, 'data', 'progress');
    await seedEvents(page, SEED);
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ naming: 'game' })), SETTINGS_KEY);
    await page.reload();

    const row = page.locator('.set-row').filter({ hasText: 'Test (development)' });
    await expect(row).toContainText('4 events');
    await expect(page.locator('.set-row').filter({ hasText: 'Mirage' })).toContainText('0 events');

    await page.getByRole('button', { name: 'Reset Test (development)' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading')).toHaveText('Reset progress for Test (development)?');
    await expect(dialog).toContainText('deletes 4 recorded events');
    await expect(dialog.getByRole('button', { name: 'Delete Test (development) progress' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep it' }).click();
    expect((await savedEvents(page)).length).toBe(7); // asking is not doing

    await page.getByRole('button', { name: 'Reset Test (development)' }).click();
    await page.getByRole('button', { name: 'Delete Test (development) progress' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Deleted 4 events for Test (development).' })).toBeVisible();
    await expect(row).toContainText('0 events');
    await expect(page.getByRole('button', { name: 'Reset Test (development)' })).toBeDisabled();

    const left = await savedEvents(page);
    expect(left.map((e) => e.callout).sort()).toEqual(['mirage.palace', 'mirage.palace', 'test2.mid']);
    expect((await stored(page))['naming']).toBe('game');
    expect(await databaseNames(page)).not.toContain('callouts');

    await part(page, 'backup').click();
    await expect(page.getByTestId('log-count')).toHaveText('3 events');
  });

  test('also forgets the summary of the session just played on that map, which would describe answers that are gone', async ({ page }) => {
    const lastSession = () => page.evaluate(() => (window as unknown as { __callouts: { lastSession: () => unknown } }).__callouts.lastSession());
    await page.goto('/?seed=1#/session/de_test');
    await play(page);
    // Package C's task 5: the Session screen must call `reportSession` (app/start-session.ts) when a session ends, which
    // nothing does yet. Until then there is nothing to forget, and this test says so instead of passing on nothing.
    test.skip((await lastSession()) === null, 'nothing calls reportSession yet, so no last session is recorded (package C)');
    expect((await savedEvents(page)).length).toBe(8);

    await page.evaluate(() => (location.hash = '#/settings?tab=data&part=progress')); // inside the page, so its memory stays
    await page.getByRole('button', { name: 'Reset Test (development)' }).click();
    await page.getByRole('button', { name: 'Delete Test (development) progress' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Deleted 8 events' })).toBeVisible();
    expect(await lastSession()).toBeNull();
    expect(await savedEvents(page)).toEqual([]);
  });

  test('is only offered for a map that has progress', async ({ page }) => {
    await openSettings(page, 'data', 'progress');
    await expect(page.getByRole('button', { name: 'Reset Test (development)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reset Mirage' })).toBeDisabled();
  });
});

// ---- offline ----

/** Wait until a worker controls the page, which is also when its install, and so its whole precache, has finished. */
async function untilControlled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());
const cachedUrls = (page: Page, name: string) =>
  page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname), name);

test.describe('offline', () => {
  test('after one visit the app opens and a whole session runs with no connection', async ({ page, context }) => {
    await page.goto('/?seed=1');
    await untilControlled(page);

    // every build file is kept, including the lazy chunks the home screen never asked for
    const names = await cacheNames(page);
    const shell = names.filter((n) => n.startsWith('callouts-shell-'));
    expect(shell).toHaveLength(1);
    const kept = await cachedUrls(page, shell[0] as string);
    expect(kept).toEqual(expect.arrayContaining(['/', '/manifest.webmanifest']));
    expect(kept.some((u) => /\/assets\/fsrs-6-.*\.js$/.test(u))).toBe(true);
    expect(kept.some((u) => /\/assets\/demo-data-.*\.js$/.test(u))).toBe(true);
    if (existsSync(BUILD_ASSETS)) {
      const files = readdirSync(BUILD_ASSETS).filter((f) => !f.endsWith('.woff')); // woff2 is enough for every browser with workers
      for (const f of files) expect(kept, f).toContain(`/assets/${f}`);
    }

    await context.setOffline(true);
    // the guard: the worker's own network is down too, or this test proves nothing
    expect(await page.evaluate(() => fetch('/assets/never-kept-anywhere.js').then(() => 'answered', () => 'refused'))).toBe('refused');

    await page.goto('about:blank');
    await page.goto('/?seed=1#/session/de_test');
    await expect(page.locator('.app')).toHaveCount(1);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const final = await play(page);
    expect(final).toMatchObject({ phase: 'done', summary: { answered: 4, correct: 4 } });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('4 / 4');
    expect((await savedEvents(page)).filter((e) => e.kind === 'answer')).toHaveLength(4); // saved with no connection

    await page.goto('about:blank');
    await page.goto('/#/settings?tab=data&part=offline');
    await expect(page.getByText('Works offline: yes')).toBeVisible();
    await context.setOffline(false);
  });

  test('a page that is reloaded offline comes from the copy and the fonts still load', async ({ page, context }) => {
    await page.goto('/#/settings?tab=keys');
    await untilControlled(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Keys' })).toHaveAttribute('aria-selected', 'true');
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.includes('IBM Plex Mono') && f.status === 'loaded');
    });
    expect(font).toBe(true);
    await context.setOffline(false);
  });

  test('says honestly whether it works offline', async ({ page }) => {
    await page.goto('/#/settings?tab=data&part=offline');
    await untilControlled(page);
    await page.reload();
    await expect(page.getByText('Works offline: yes. The app is saved on this device.')).toBeVisible();
    await expect(page.locator('.set-worker')).toHaveAttribute('data-state', 'ready');
  });

  test('the development map shows that its pictures are built in, with nothing to download', async ({ page }) => {
    await openSettings(page, 'data', 'offline');
    await expect(page.locator('[data-map="de_test"]')).toContainText('built in, nothing to download');
    await expect(page.locator('[data-map="de_test"]').getByRole('button')).toHaveCount(0);
    await expect(page.locator('[data-map="de_mirage"]')).toContainText('no pictures yet');
  });

  test('a downloaded pack shows its real size, serves its pictures with no connection, and can be removed', async ({ page, context }) => {
    const pictures = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
    const bytes = pictures.reduce((sum, f) => sum + statSync(new URL(`../public/icons/${f}`, import.meta.url)).size, 0);
    await page.goto('/#/settings?tab=data&part=backup');
    await untilControlled(page);
    await addPack(page, pictures);
    await part(page, 'offline').click();
    await showPack(page);

    const row = page.locator('[data-map="de_pack"]');
    await expect(row).toContainText('3 pictures, not downloaded');
    await row.getByRole('button', { name: 'Download for offline' }).click();
    await expect(row).toContainText('3 pictures,');
    await expect(row.getByRole('button', { name: 'Update' })).toBeVisible();
    const shown = /(\d+) KB/.exec((await row.textContent()) ?? '');
    expect(Number(shown?.[1])).toBe(Math.round(bytes / 1024)); // the size on screen is the size that was saved
    expect(await cachedUrls(page, 'callouts-pack-v1-de_pack')).toEqual(expect.arrayContaining(pictures.map((f) => `/icons/${f}`)));

    // take the pictures out of the app's own cache, so only the pack can answer for them
    await page.evaluate(async (files) => {
      for (const name of await caches.keys()) {
        if (!name.startsWith('callouts-shell-')) continue;
        const cache = await caches.open(name);
        for (const f of files) await cache.delete(new URL(`/icons/${f}`, location.href).href);
      }
    }, pictures);

    await context.setOffline(true);
    expect(await page.evaluate(() => fetch('/icons/never-kept.png').then(() => 'answered', () => 'refused'))).toBe('refused');
    for (const f of pictures) {
      const answer = await page.evaluate((file) => fetch(`/icons/${file}`).then((r) => `${r.status} ${r.headers.get('content-type')}`), f);
      expect(answer, f).toBe('200 image/png');
    }
    await context.setOffline(false);

    await row.getByRole('button', { name: 'Remove Pack test pictures' }).click();
    await expect(row).toContainText('3 pictures, not downloaded');
    expect(await cacheNames(page)).not.toContain('callouts-pack-v1-de_pack');
  });

  test('a picture that fails leaves a partial pack the learner can finish', async ({ page }) => {
    await page.goto('/#/settings?tab=data&part=backup');
    await addPack(page, ['icon-192.png', 'missing.png']);
    await part(page, 'offline').click();
    await showPack(page);
    const row = page.locator('[data-map="de_pack"]');
    await row.getByRole('button', { name: 'Download for offline' }).click();
    await expect(row).toContainText('1 of 2 pictures saved');
    await expect(page.getByText('Pack test: 1 of 2 pictures saved. Press Finish download to try the rest again.')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Finish download' })).toBeVisible();
    expect(await cachedUrls(page, 'callouts-pack-v1-de_pack')).not.toContain('/icons/missing.png'); // an error page is not a picture
  });

  test('a new build installs its own cache, deletes the old one, and keeps downloaded packs', async ({ page }) => {
    await page.goto('/');
    await untilControlled(page);
    const [first] = (await cacheNames(page)).filter((n) => n.startsWith('callouts-shell-'));
    expect(first).toBeTruthy();
    await page.evaluate(async () => {
      const keep = await caches.open('callouts-pack-v1-de_keep');
      await keep.put('/shots/kept.avif', new Response('x', { headers: { 'content-type': 'image/avif' } }));
      await caches.open('callouts-pack-de_old'); // the format before versions
      await caches.open('some-other-sites-cache');
    });

    // the page registers `sw.js?build=<id>`; a different id is a different worker, as after a rebuild
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js?build=next1', { scope: '/', updateViaCache: 'none' }).then(() => undefined));
    await expect.poll(() => cacheNames(page), { timeout: 20_000 }).toContain('callouts-shell-next1');
    await expect.poll(() => cacheNames(page), { timeout: 20_000 }).not.toContain(first);

    const names = await cacheNames(page);
    expect(names).toContain('callouts-pack-v1-de_keep');
    expect(names).not.toContain('callouts-pack-de_old');
    expect(names).toContain('some-other-sites-cache');
    expect((await cachedUrls(page, 'callouts-shell-next1')).some((u) => u.startsWith('/assets/'))).toBe(true);
  });

  test('the app manifest and icons are served and describe an installable app', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = (await (await request.get(href ?? '/manifest.webmanifest')).json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
    expect(manifest).toMatchObject({ name: 'callouts_', display: 'standalone' });
    expect(manifest.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((i) => i.type === 'image/svg+xml')).toBe(true);
    for (const icon of manifest.icons) {
      const response = await request.get(`/${icon.src}`);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()['content-type'], icon.src).toContain(icon.type.split('+')[0] as string);
    }
  });
});
