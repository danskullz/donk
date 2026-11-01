// Browser tests for Home (#/) and the Map screen (#/map/<id>): the lists and links, zone tabs, paging, Hard mode and its
// persistence, the keyboard, the one-viewport rule at all nine window sizes (SCOPE §5.3 rule 9), and the map's pinch,
// minimap and tap-to-zoom assist. The synthetic map `de_test` stands in for a real one (the e2e build includes it).
//
// Written in the pattern of session.spec.ts. The owner's machine runs these in the Edge that ships with Windows; the
// first run of this file was made in Chromium on Linux (see docs/notes/map.md for exactly what ran).

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectFits, seedVeteran } from './support';

const SETTINGS_KEY = 'callouts.settings';

/** The nine window sizes of SCOPE §5.3 and the brief: desktop, tablet, phone, two landscape phones. */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 844, height: 390 },
  { width: 640, height: 360 },
] as const;

/** A learner who has seen the primer, so Home does not send them away. Written once: a reload keeps what the app saved. */
async function seen(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([key, settings]) => {
      if (!localStorage.getItem(key as string)) localStorage.setItem(key as string, JSON.stringify(settings));
    },
    [SETTINGS_KEY, { primerSeen: true, ...extra }] as const,
  );
}

const home = async (page: Page) => {
  await page.goto('/?seed=1#/');
  // the grid is drawn from the index at once; the development map and the numbers arrive when the maps have loaded
  await expect(page.locator('.card[data-map="de_test"]')).toBeVisible();
  await expect(page.locator('.today .big')).not.toHaveText('Loading…');
};
const mapScreen = async (page: Page, id = 'de_test') => {
  await page.goto(`/?seed=1#/map/${id}`);
  await page.waitForSelector('.mp-body, .mp-note:not(.loading)');
};
const saved = (page: Page): Promise<Record<string, unknown>> => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SETTINGS_KEY);
const zoomOf = async (page: Page) => Number(await page.locator('.stage').first().getAttribute('data-zoom'));
const rowIds = (page: Page): Promise<string[]> => page.locator('.mp-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['id'] ?? ''));
const selectedRow = (page: Page) => page.locator('.mp-row[aria-current="true"]');
const region = (page: Page, id: string): Locator => page.locator(`path.rg[data-id="${id}"]`);

// ------------------------------------------------------------------------------------------------------------- Home

const card = (page: Page, id: string): Locator => page.locator(`.card[data-map="${id}"]`);

test.describe('Home', () => {
  test.beforeEach(async ({ page }) => seen(page));

  test('shows every map of the index at once, in index order, and the development map at the end of this build', async ({ page }) => {
    await home(page);
    const ids = await page.locator('.card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['map']));
    expect(ids).toEqual(['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo', 'de_test']);
    // the maps that are still to come are dimmed, say so, and are not links
    const coming = page.locator('article.card.soon');
    await expect(coming).toHaveCount(9);
    await expect(coming.first()).toContainText('Coming');
    await expect(page.locator('a.card.soon')).toHaveCount(0);
    await expect(page.locator('a.card')).toHaveCount(2); // Mirage and the development map
  });

  test('says honestly that Mirage has no callouts yet, and that the test map is for development', async ({ page }) => {
    await home(page);
    await expect(card(page, 'de_mirage')).toContainText('No callouts yet');
    await expect(card(page, 'de_mirage')).not.toContainText('%');
    await expect(card(page, 'de_test')).toContainText('dev map');
  });

  test('marks the recommended map, and the primary button starts a session on it', async ({ page }) => {
    await home(page);
    await expect(card(page, 'de_test').locator('.tag')).toHaveText(/start here/i);
    await expect(page.locator('.card .tag')).toHaveCount(1);
    const start = page.getByRole('link', { name: /start session/i });
    await expect(start).toHaveAttribute('href', '#/session/de_test');
    await expect(page.locator('.today .big')).toHaveText(/^0 due · 4 new$/);
    await start.click();
    await expect(page).toHaveURL(/#\/session\/de_test$/);
  });

  test('opens a map from its card, and links to Progress and Settings', async ({ page }) => {
    await home(page);
    await card(page, 'de_test').click();
    await expect(page).toHaveURL(/#\/map\/de_test$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page).toHaveURL(/#\/progress$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/#\/settings$/);
  });

  test('a map with no callouts still opens, to a plain explanation', async ({ page }) => {
    await home(page);
    await card(page, 'de_mirage').click();
    await expect(page).toHaveURL(/#\/map\/de_mirage$/);
    await expect(page.getByText('Nothing to learn here yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quiz this map' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Study' })).toBeDisabled();
  });

  test('shows progress for a learner with a history: percent, Core x of y, due counts and a way to continue', async ({ page }) => {
    await seedVeteran(page);
    await home(page);
    const c = card(page, 'de_test');
    await expect(c.locator('.pct')).toHaveText(/^\d+%$/);
    await expect(c).toContainText(/core \d+ of 5/i);
    await expect(c.locator('.low .chip.due')).toHaveText(/\d+ due/);
    await expect(page.locator('.today .big')).toHaveText(/^\d+ due · \d+ new$|^All caught up$/);
    await expect(page.locator('.bar .chip.due')).toHaveText(/\d+ due/);
    await expect(page.getByRole('link', { name: /continue/i })).toHaveAttribute('href', '#/map/de_test');
    // somebody who has started is not told to "start here"
    await expect(c.locator('.tag')).not.toHaveText(/start here/i);
  });

  test('draws the mini-map of a map that has callouts, filled by mastery', async ({ page }) => {
    await seedVeteran(page);
    await home(page);
    const c = card(page, 'de_test');
    await expect(c.locator('path.rg')).toHaveCount(8);
    const states = await c.locator('path.rg').evaluateAll((els) => els.map((e) => (e as SVGElement).dataset['mastery']));
    expect(states.every((s) => s !== undefined && s !== 'new')).toBe(true);
  });

  test('a user who has seen the primer is not sent there', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('.card').first()).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('arrow keys move between the maps that can be opened, Enter opens one, and Enter on the page starts a session', async ({ page }) => {
    await home(page);
    await card(page, 'de_mirage').focus();
    await page.keyboard.press('ArrowRight'); // the maps still to come are skipped
    await expect(card(page, 'de_test')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // nothing further to open: stays where it is
    await expect(card(page, 'de_test')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page, 'de_mirage')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/map\/de_test$/);
    await page.goBack();
    await expect(page.locator('.card').first()).toBeVisible();
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/session\/de_test$/);
  });

  for (const vp of VIEWPORTS) {
    test(`fits the window at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await home(page);
      await expectFits(page, `Home at ${vp.width}x${vp.height}`);
      // every card is on screen: nothing was cut off to make it fit
      const boxes = await page.locator('.card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.right, r.bottom]));
      expect(boxes).toHaveLength(11);
      for (const [right, bottom] of boxes as [number, number][]) {
        expect(right).toBeLessThanOrEqual(vp.width + 1);
        expect(bottom).toBeLessThanOrEqual(vp.height + 1);
      }
    });

    test(`fits with a learner's history at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await seedVeteran(page);
      await home(page);
      await expect(card(page, 'de_test').locator('.pct')).toBeVisible();
      await expectFits(page, `Home with progress at ${vp.width}x${vp.height}`);
    });
  }
});

// -------------------------------------------------------------------------------------------------- Home, first run

test.describe('Home, first run', () => {
  // no `seen`: the settings are the defaults, so primerSeen is false

  test('sends a first-time user to the primer once, and does not loop when they come back', async ({ page }) => {
    await page.goto('/?seed=1#/');
    await expect(page).toHaveURL(/#\/primer$/);
    // coming back to Home without having marked the primer seen (it may be a stub): stay on Home
    await page.evaluate(() => {
      location.hash = '#/';
    });
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.card').first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/$/);
  });

  test('only Home sends a first-time user to the primer: a map address opens as asked', async ({ page }) => {
    await page.goto('/?seed=1#/map/de_test');
    await expect(page.locator('.mp-body')).toBeVisible();
    await expect(page).toHaveURL(/#\/map\/de_test$/);
  });
});

// -------------------------------------------------------------------------------------------------------------- Map

test.describe('Map', () => {
  test.beforeEach(async ({ page }) => seen(page));

  test('has a tab for every zone in route order, and the list shows the open zone', async ({ page }) => {
    await mapScreen(page);
    await expect(page.getByRole('tab')).toHaveText(['Spawn', 'Mid', 'A', 'B']);
    await expect(page.getByRole('tab', { name: 'Spawn' })).toHaveAttribute('aria-selected', 'true');
    expect(await rowIds(page)).toEqual(['test.t-spawn']);
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    expect(await rowIds(page)).toEqual(['test.a-ramp', 'test.a-site', 'test.palace']);
    await page.getByRole('tab', { name: 'B', exact: true }).click();
    expect(await rowIds(page)).toEqual(['test.b-site', 'test.b-apps']);
  });

  test('selecting a row selects the region on the map and fills the peek; clicking a region does the reverse', async ({ page }) => {
    await mapScreen(page);
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    await page.locator('.mp-row[data-id="test.a-site"]').click();
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.a-site');
    await expect(region(page, 'test.a-site')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('path.ring')).toHaveCount(1);
    await expect(page.locator('.mp-peek h3')).toHaveText('A Site');
    await expect(page.locator('.mp-peek p')).toContainText('A Site in the test map.');
    await expect(page.locator('.mp-peek img')).toBeVisible();

    // a region of another zone: its zone opens and its row is the selected one
    await region(page, 'test.connector').click();
    await expect(page.getByRole('tab', { name: 'Mid' })).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.connector');
    await expect(page.locator('.mp-peek h3')).toHaveText('Connector');
  });

  test('the map is the progress bar: regions carry the mastery state of their callout', async ({ page }) => {
    await seedVeteran(page);
    await mapScreen(page);
    const states = await page.locator('path.rg').evaluateAll((els) => els.map((e) => (e as SVGElement).dataset['mastery']));
    expect(states).toHaveLength(8);
    expect(states.every((s) => s !== undefined && s !== 'new')).toBe(true);
    // and the list row says the same as the map
    const row = page.locator('.mp-row').first();
    const id = await row.getAttribute('data-id');
    expect(await row.getAttribute('data-mastery')).toBe(await region(page, id ?? '').getAttribute('data-mastery'));
    await expect(page.locator('.mp-legend')).toContainText('Automatic');
  });

  test('says what is due: a count in the bar and a flag on the rows that have something due', async ({ page }) => {
    await seedVeteran(page);
    await mapScreen(page);
    await expect(page.locator('.bar .chip.due')).toHaveText(/\d+ due/);
    await expect(page.locator('.mp-row .due:not(.none)').first()).toBeVisible();
  });

  test('has the buttons: Quiz this map, Study and Quiz this zone', async ({ page }) => {
    await mapScreen(page);
    await expect(page.getByRole('link', { name: /Quiz this map/ })).toHaveAttribute('href', '#/session/de_test');
    await expect(page.getByRole('link', { name: /Study/ })).toHaveAttribute('href', '#/study/de_test');
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Quiz this zone' })).toHaveAttribute('href', '#/session/de_test?zone=a');
    await page.getByRole('link', { name: 'Quiz this zone' }).click();
    await expect(page).toHaveURL(/#\/session\/de_test\?zone=a$/);
  });

  test('Hard mode: off by default, the switch adds the Hard spot to the map and the list, and the choice survives a reload', async ({ page }) => {
    await mapScreen(page);
    const hard = page.getByRole('switch');
    await expect(hard).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.bar .chip').first()).toContainText('off · 1 hidden');
    await expect(page.locator('path.rg')).toHaveCount(8);
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    expect(await rowIds(page)).not.toContain('test.bench');

    await hard.click();
    await expect(hard).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.bar .chip').first()).toContainText('on · 1 spot');
    await expect(page.locator('path.rg')).toHaveCount(9);
    // the spot is listed under its callout, indented, and drawn as an inlay
    expect(await rowIds(page)).toEqual(['test.a-ramp', 'test.a-site', 'test.bench', 'test.palace']);
    await expect(page.locator('.mp-row.nested')).toHaveCount(1);
    await expect(region(page, 'test.bench')).toHaveClass(/hs/);
    expect(((await saved(page))['hardMode'] as Record<string, boolean>)['de_test']).toBe(true);

    await page.reload();
    await page.waitForSelector('.mp-row');
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('path.rg')).toHaveCount(9);

    await page.getByRole('switch').click();
    await expect(page.locator('path.rg')).toHaveCount(8);
    expect(((await saved(page))['hardMode'] as Record<string, boolean>)['de_test']).toBe(false);
  });

  test('Hard mode of one map does not change the default for others', async ({ page }) => {
    await mapScreen(page);
    await page.getByRole('switch').click();
    const settings = await saved(page);
    expect(settings['hardModeDefault']).toBe(false);
    expect(settings['hardMode']).toEqual({ de_test: true });
  });

  test('a click on a Hard spot picks the spot, and a click elsewhere in its callout picks the callout (the smallest region wins)', async ({ page }) => {
    await page.addInitScript(([k]) => localStorage.setItem(k as string, JSON.stringify({ primerSeen: true, hardMode: { de_test: true } })), [SETTINGS_KEY]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await mapScreen(page);
    const centre = async (id: string) => {
      const b = (await region(page, id).boundingBox()) as { x: number; y: number; width: number; height: number };
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
    };
    // zoom in on the spot with the wheel, which keeps the point under the pointer where it is
    const spot = await centre('test.bench');
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, -1500);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(4);
    const zoomedSpot = await centre('test.bench');
    await page.mouse.click(zoomedSpot.x, zoomedSpot.y);
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.bench');

    // back to the whole map; the same callout's top right corner, away from the spot, is the callout itself
    await page.getByRole('button', { name: 'Fit to frame' }).click();
    await expect.poll(() => zoomOf(page)).toBe(1);
    const site = (await region(page, 'test.a-site').boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.click(site.x + site.width * 0.92, site.y + site.height * 0.08);
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.a-site');
  });

  test('pages a list that does not fit and never scrolls it', async ({ page }) => {
    // 1024 x 600 is the smallest desktop window: the list has room for few rows, and zone A with its Hard spot has four
    await page.addInitScript(([k]) => localStorage.setItem(k as string, JSON.stringify({ primerSeen: true, hardMode: { de_test: true } })), [SETTINGS_KEY]);
    await page.setViewportSize({ width: 1024, height: 600 });
    await mapScreen(page);
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    const pager = page.locator('.mp-pager');
    await expect(pager).toBeVisible();
    const first = await rowIds(page);
    expect(first.length).toBeLessThan(4);
    // a callout and its Hard spot are never split across pages
    if (first.includes('test.a-site')) expect(first).toContain('test.bench');
    await expect(pager.locator('.nums')).toHaveText(/^1 \/ \d+$/);
    await expectFits(page, 'Map, first page');

    await page.getByRole('button', { name: 'Next page' }).click();
    const second = await rowIds(page);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((id) => first.includes(id))).toBe(false);
    await expect(pager.locator('.nums')).toHaveText(/^2 \/ \d+$/);
    await expectFits(page, 'Map, second page');
    await page.getByRole('button', { name: 'Previous page' }).click();
    expect(await rowIds(page)).toEqual(first);

    // the keys of the comp: . next, , previous
    await page.keyboard.press('.');
    expect(await rowIds(page)).toEqual(second);
    await page.keyboard.press(',');
    expect(await rowIds(page)).toEqual(first);
  });

  test('choosing a callout on the map turns to the page that holds its row', async ({ page }) => {
    await page.addInitScript(([k]) => localStorage.setItem(k as string, JSON.stringify({ primerSeen: true, hardMode: { de_test: true } })), [SETTINGS_KEY]);
    await page.setViewportSize({ width: 1024, height: 600 });
    await mapScreen(page);
    await page.getByRole('tab', { name: 'A', exact: true }).click();
    await expect(page.locator('.mp-pager .nums')).toHaveText(/^1 \/ \d+$/);
    await region(page, 'test.palace').click();
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.palace');
    await expect(page.locator('.mp-pager .nums')).not.toHaveText(/^1 \//);
    expect(await rowIds(page)).toContain('test.palace');
  });

  test('keyboard: tabs with the arrow keys, regions with the arrow keys and Enter, H for Hard mode, Escape for Home', async ({ page }) => {
    await mapScreen(page);
    // zone tabs: roving focus, the arrow keys open the next zone
    await page.getByRole('tab', { name: 'Spawn' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Mid' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Mid' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'B', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Spawn' })).toBeFocused();

    // regions are buttons named after their callout and state; the arrows move to the nearest region in that direction
    await region(page, 'test.t-spawn').focus();
    await page.keyboard.press('ArrowRight');
    await expect(region(page, 'test.mid')).toBeFocused();
    await page.keyboard.press('ArrowUp'); // north of Mid is B Site
    await expect(region(page, 'test.b-site')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(region(page, 'test.connector')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(region(page, 'test.b-site')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.b-site');
    await expect(page.getByRole('button', { name: 'B Site, new' })).toBeVisible();

    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('h');
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('h');
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/$/);
  });

  test('Enter on the page starts a quiz; on a row or a region it keeps its own meaning', async ({ page }) => {
    await mapScreen(page);
    await page.locator('.mp-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/map\/de_test$/);
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/session\/de_test$/);
  });

  test('an unknown map and a map that is still to come say so', async ({ page }) => {
    await mapScreen(page, 'de_nowhere');
    await expect(page.getByText('There is no map called de_nowhere.')).toBeVisible();
    await mapScreen(page, 'de_dust2');
    await expect(page.getByText('is not built yet.')).toBeVisible();
    await expectFits(page, 'a map that is not built');
  });

  test('Mirage, which has no callouts yet: a plain explanation, disabled buttons, and no Hard switch', async ({ page }) => {
    await mapScreen(page, 'de_mirage');
    await expect(page.getByText('Nothing to learn here yet.')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Quiz this zone' })).toBeDisabled();
    await expectFits(page, 'Mirage, no callouts');
  });

  for (const vp of VIEWPORTS) {
    test(`fits the window at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await mapScreen(page);
      await expectFits(page, `Map at ${vp.width}x${vp.height}`);
    });

    test(`fits with Hard mode on, a history and a zoomed map at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.addInitScript(([k]) => localStorage.setItem(k as string, JSON.stringify({ primerSeen: true, hardMode: { de_test: true } })), [SETTINGS_KEY]);
      await page.setViewportSize(vp);
      await seedVeteran(page);
      await mapScreen(page);
      await page.getByRole('tab', { name: 'A', exact: true }).click();
      await page.locator('.zbtn[aria-label="Zoom in"]').click();
      await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.5);
      await expectFits(page, `Map, Hard mode, zoomed, at ${vp.width}x${vp.height}`);
    });
  }
});

// ---------------------------------------------------------------------------------- pinch, minimap, tap-to-zoom assist

test.describe('the map component', () => {
  test.beforeEach(async ({ page }) => {
    await seen(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // `test.beforeEach` of this block does not open the page: some of the tests need Hard mode on before it loads.
  const HARD = [SETTINGS_KEY] as const;
  const hardOn = (page: Page) => page.addInitScript(([k]) => localStorage.setItem(k as string, JSON.stringify({ primerSeen: true, hardMode: { de_test: true } })), HARD);

  /** Two pointers that move apart (or together) along a horizontal line through the middle of the map. */
  async function pinch(page: Page, from: number, to: number) {
    await page.evaluate(
      ({ from, to }) => {
        const svg = document.querySelector('.stage svg') as SVGSVGElement;
        const r = svg.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const fire = (type: string, id: number, x: number) =>
          svg.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: cy, button: 0, bubbles: true, cancelable: true }));
        fire('pointerdown', 1, cx - from);
        fire('pointerdown', 2, cx + from);
        for (let i = 1; i <= 10; i++) {
          const d = from + ((to - from) * i) / 10;
          fire('pointermove', 1, cx - d);
          fire('pointermove', 2, cx + d);
        }
        fire('pointerup', 1, cx - to);
        fire('pointerup', 2, cx + to);
      },
      { from, to },
    );
  }

  test('starts fit to the frame, with no minimap, and the zoom-out button is off', async ({ page }) => {
    await mapScreen(page);
    expect(await zoomOf(page)).toBe(1);
    await expect(page.locator('.minimap')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Fit to frame' })).toBeDisabled();
  });

  test('two fingers moving apart zoom in, and together zoom out again, never past the fit', async ({ page }) => {
    await mapScreen(page);
    await pinch(page, 40, 120);
    const zoomed = await zoomOf(page);
    expect(zoomed).toBeGreaterThan(2);
    await pinch(page, 120, 40);
    expect(await zoomOf(page)).toBeLessThan(zoomed);
    await pinch(page, 120, 2);
    expect(await zoomOf(page)).toBe(1);
  });

  test('a pinch is not a pick: nothing is selected by it', async ({ page }) => {
    await mapScreen(page);
    const before = await selectedRow(page).getAttribute('data-id');
    await pinch(page, 40, 120);
    expect(await selectedRow(page).getAttribute('data-id')).toBe(before);
  });

  test('zooming shows a minimap with the visible part outlined; dragging in it moves the view', async ({ page }) => {
    await mapScreen(page);
    await page.locator('.zbtn[aria-label="Zoom in"]').click();
    await page.locator('.zbtn[aria-label="Zoom in"]').click();
    const minimap = page.locator('.minimap svg');
    await expect(minimap).toBeVisible();
    const viewBox = () => page.locator('.stage svg').getAttribute('viewBox');
    const before = await viewBox();
    const outline = () => page.locator('.minimap .vp').evaluate((el) => [Number(el.getAttribute('x')), Number(el.getAttribute('y'))]);
    const o0 = await outline();
    const box = (await minimap.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
    expect(await viewBox()).not.toBe(before);
    const o1 = await outline();
    expect(o1[0]).toBeGreaterThan(o0[0] as number);
    expect(o1[1]).toBeGreaterThan(o0[1] as number);
    // zoomed all the way out again, the minimap goes
    await page.getByRole('button', { name: 'Fit to frame' }).click();
    expect(await zoomOf(page)).toBe(1);
    await expect(page.locator('.minimap')).toHaveCount(0);
  });

  test('the + and - keys and the wheel zoom too', async ({ page }) => {
    await mapScreen(page);
    await region(page, 'test.mid').focus();
    await page.keyboard.press('+');
    expect(await zoomOf(page)).toBeGreaterThan(1.5);
    await page.keyboard.press('-');
    expect(await zoomOf(page)).toBe(1);
    await page.locator('.stage svg').hover();
    await page.mouse.wheel(0, -400);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(1.3);
  });

  test('a finger on a region under 44 px zooms in on it first; the next tap selects it', async ({ page }) => {
    await hardOn(page);
    await mapScreen(page);
    const tap = (id: string, type: 'touch' | 'mouse') =>
      page.evaluate(
        ([regionId, pointerType]) => {
          const el = document.querySelector(`path.rg[data-id="${regionId}"]`) as SVGGraphicsElement;
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const init = { pointerId: 7, pointerType: pointerType as string, isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true };
          el.dispatchEvent(new PointerEvent('pointerdown', init));
          el.dispatchEvent(new PointerEvent('pointerup', init));
        },
        [id, type] as const,
      );
    // the Hard spot is a little under 40 px wide at the fit zoom of this window
    const side = await region(page, 'test.bench').evaluate((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
    expect(side).toBeLessThan(44);
    const before = await selectedRow(page).getAttribute('data-id');
    await tap('test.bench', 'touch');
    expect(await zoomOf(page)).toBeGreaterThan(1.5);
    // the first tap only zoomed, until the region is a target of at least 44 px
    expect(await selectedRow(page).getAttribute('data-id')).toBe(before);
    expect(await region(page, 'test.bench').evaluate((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
    await tap('test.bench', 'touch');
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.bench');
  });

  test('a mouse click on a small region selects it at once: the mouse is exact enough', async ({ page }) => {
    await hardOn(page);
    await mapScreen(page);
    const b = (await region(page, 'test.bench').boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(selectedRow(page)).toHaveAttribute('data-id', 'test.bench');
    expect(await zoomOf(page)).toBeLessThan(2.5);
  });
});
