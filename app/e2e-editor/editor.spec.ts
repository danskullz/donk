import { expect, test } from '@playwright/test';
import {
  addCallout, backupCount, chooseTool, clickAt, corners, dataExists, dragOver, MAP, openEditor, readData, resetFixture, save, screenAt, smallBrush, tab, writeData,
} from './support';

interface SavedCallout {
  id: string;
  name: string;
  region: number[][];
  anchor: number[];
  neighbours: string[];
  tier: number;
  parent: string | null;
  zone: string;
  blurb: string;
}
interface WorkFile {
  callouts: SavedCallout[];
  paint: Record<string, number[]>;
  plan: Record<string, { pos: number[]; yaw: number; kind: string }[]>;
}

test.beforeEach(async ({ page }) => {
  resetFixture();
  await openEditor(page);
});

test('opens a map with its nav mesh drawn and nothing in the list', async ({ page }) => {
  await expect(page.getByText('No callouts yet')).toBeVisible();
  // 8 x 4 cells with one column split in two: 36 areas, drawn as one path
  const d = await page.locator('path.unassigned').getAttribute('d');
  expect(d?.split('M').length).toBe(1 + 36);
  await expect(page.getByRole('button', { name: /^Paint/ })).toBeVisible();
});

test('paints a callout by dragging, outlines it as one region, and saves only what is finished', async ({ page }) => {
  await addCallout(page, 'Alpha');
  // the form shows the callout's own zone and tier, not blanks
  await expect(page.getByLabel('Zone', { exact: true })).toHaveValue('west');
  await expect(page.getByLabel('Tier', { exact: true })).toHaveValue('2');
  await smallBrush(page);
  await dragOver(page, [[50, 50], [150, 50], [250, 50]]);

  await expect(page.getByText('3 nav areas painted · 4 corners')).toBeVisible();
  await expect(page.locator('path.outline.selected')).toHaveCount(1);

  // no blurb yet: the work file keeps it, the content file does not
  await save(page);
  expect(readData<SavedCallout[]>(`callouts/${MAP}.json`)).toEqual([]);
  const work = readData<WorkFile>(`editor/${MAP}.work.json`);
  expect(work.callouts.map((c) => c.id)).toEqual(['grid.alpha']);
  expect(work.paint['grid.alpha']).toHaveLength(3);

  await page.getByLabel('One line on where it is, relative to what a beginner knows').fill('The west edge of the grid.');
  await page.getByLabel('Name', { exact: true }).focus();
  await save(page);
  const saved = readData<SavedCallout[]>(`callouts/${MAP}.json`);
  expect(saved).toHaveLength(1);
  expect(corners(saved[0]!.region)).toEqual(['0,0', '0,100', '300,0', '300,100']);
  expect(saved[0]!.blurb).toBe('The west edge of the grid.');
  expect(saved[0]!.anchor[0]).toBeGreaterThan(0);

  // everything comes back after a reload, paint included
  await page.reload();
  await expect(page.getByText('all saved')).toBeVisible();
  await tab(page, 'Callouts');
  await page.getByRole('button', { name: /Alpha/ }).click();
  await expect(page.getByText('3 nav areas painted · 4 corners')).toBeVisible();
});

test('fills what is connected, out to the fill radius, and stops at areas another callout owns', async ({ page }) => {
  await addCallout(page, 'Wall');
  await smallBrush(page);
  // a column of areas all the way up at x 300-400
  await dragOver(page, [[350, 20], [350, 380]]);
  await expect(page.getByText(/\d+ nav areas painted/)).toBeVisible();

  await page.getByLabel('overwrite others').uncheck();
  await addCallout(page, 'Room');
  await chooseTool(page, 'Fill');
  await clickAt(page, 50, 50);
  // x 0-300 by y 0-400 is 12 areas, within the default 500-unit radius of the first area's centre
  const text = await page.getByText(/\d+ nav areas painted/).textContent();
  const count = Number(/(\d+) nav areas/.exec(text ?? '')?.[1]);
  expect(count).toBeGreaterThanOrEqual(10);
  expect(count).toBeLessThanOrEqual(12);
  // the wall callout kept its areas
  await tab(page, 'Callouts');
  await page.getByRole('button', { name: /Wall/ }).click();
  await expect(page.getByText('4 nav areas painted')).toBeVisible();
});

test('undo and redo take a whole stroke back and forward', async ({ page }) => {
  await addCallout(page, 'Undoable');
  await smallBrush(page);
  await dragOver(page, [[50, 50], [150, 50]]);
  await expect(page.getByText('2 nav areas painted')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('No region yet.')).toBeVisible();
  await expect(page.getByText('all saved')).not.toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('2 nav areas painted')).toBeVisible();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // the callout itself
  await tab(page, 'Callouts');
  await expect(page.getByText('No callouts yet')).toBeVisible();
  await expect(page.getByText('all saved')).toBeVisible();
});

test('draws a region by hand with the polygon tool', async ({ page }) => {
  await addCallout(page, 'By Hand');
  await chooseTool(page, 'Polygon');
  for (const [x, y] of [[420, 120], [680, 120], [680, 330], [420, 330]]) await clickAt(page, x!, y!);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Drawn by hand · 4 corners')).toBeVisible();
  await page.getByLabel('One line on where it is, relative to what a beginner knows').fill('A box on the east side.');
  await page.getByLabel('Name', { exact: true }).focus();
  await save(page);
  const saved = readData<SavedCallout[]>(`callouts/${MAP}.json`);
  // clicks land on whole screen pixels, so allow a unit or two
  const want = [[420, 120], [680, 120], [680, 330], [420, 330]];
  expect(saved[0]!.region).toHaveLength(4);
  for (const [x, y] of want) expect(saved[0]!.region.some(([rx, ry]) => Math.abs(rx! - x!) <= 2 && Math.abs(ry! - y!) <= 2)).toBe(true);
});

test('suggests neighbours from the mesh, links them both ways, and stops at four', async ({ page }) => {
  await addCallout(page, 'Centre');
  await smallBrush(page);
  await dragOver(page, [[250, 150], [250, 250]]);
  const around: [string, number, number][] = [['North', 250, 350], ['South', 250, 50], ['West Side', 150, 200], ['East Side', 350, 200], ['Far', 700, 200]];
  for (const [name, x, y] of around) {
    await addCallout(page, name);
    await smallBrush(page);
    await dragOver(page, [[x, y], [x, y + 1]]);
  }
  await tab(page, 'Callouts');
  await page.getByRole('button', { name: /Centre/ }).click();
  // the four that touch are offered, the far one is not
  for (const n of ['North', 'South', 'West Side', 'East Side']) await expect(page.getByRole('button', { name: `+ ${n}` })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Far' })).toHaveCount(0);
  for (const n of ['North', 'South', 'West Side', 'East Side']) await page.getByRole('button', { name: `+ ${n}` }).click();
  await expect(page.getByText('4 / 4')).toBeVisible();

  // a fifth is refused, with the reason
  await page.getByLabel('Add another').selectOption({ label: 'Far' });
  await expect(page.getByText('Centre already has 4 neighbours')).toBeVisible();

  // the other side has the link too
  await tab(page, 'Callouts');
  await page.getByRole('button', { name: /North/ }).click();
  await expect(page.getByLabel('Remove Centre')).toBeVisible();
});

test('plans shots from the shape of a callout, previews what they see, and writes the capture manifest', async ({ page }) => {
  await addCallout(page, 'Middle');
  await page.getByLabel('One line on where it is, relative to what a beginner knows').fill('The middle of the grid.');
  await chooseTool(page, 'Fill');
  await page.getByLabel('Fill radius').evaluate((el: HTMLInputElement) => {
    el.value = '250';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickAt(page, 350, 150);
  await tab(page, 'Shots');
  await page.getByRole('button', { name: 'Propose shots' }).click();
  await expect(page.getByText('Shot 3')).toBeVisible();
  await expect(page.locator('circle.marker')).toHaveCount(3);
  // eye height is the floor (z 0) plus 60
  await expect(page.getByLabel('z (eye)').first()).toHaveValue('60');
  await save(page);
  const manifest = readData<{ shots: { id: string; pose: { z: number; title: string } }[] }>(`editor/${MAP}.capture-manifest.json`);
  expect(manifest.shots.length).toBeGreaterThanOrEqual(3);
  expect(manifest.shots.every((s) => s.id === 'grid.middle' && s.pose.z === 60)).toBe(true);

  // a marker can be dragged: one undo step puts it back
  const before = await page.getByLabel('x', { exact: true }).first().inputValue();
  const marker = page.locator('circle.marker').first();
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 5 });
  await page.mouse.up();
  expect(await page.getByLabel('x', { exact: true }).first().inputValue()).not.toBe(before);
  await page.keyboard.press('Control+z');
  expect(await page.getByLabel('x', { exact: true }).first().inputValue()).toBe(before);
});

test('keeps Hard spots inside their parent: painting one does not take areas from it', async ({ page }) => {
  await addCallout(page, 'Parent');
  await smallBrush(page);
  await dragOver(page, [[50, 150], [350, 150]]);
  await expect(page.getByText('4 nav areas painted')).toBeVisible();
  await addCallout(page, 'Spot', 'West', '3');
  await page.getByLabel('Sits inside (a standard callout)').selectOption({ label: 'Parent' });
  await smallBrush(page);
  await dragOver(page, [[150, 150], [160, 150]]);
  await expect(page.getByText(/1 nav areas? painted/)).toBeVisible();
  await tab(page, 'Callouts');
  await page.getByRole('button', { name: /Parent/ }).click();
  await expect(page.getByText('4 nav areas painted')).toBeVisible();
});

test('says so when the files changed on disk, and keeps the unsaved work until reloaded', async ({ page }) => {
  await addCallout(page, 'Contested');
  await smallBrush(page);
  await dragOver(page, [[50, 50], [150, 50]]);
  // someone edits the content file by hand
  writeData(`callouts/${MAP}.json`, []);
  writeData(`maps/${MAP}.json`, { ...readData<object>(`maps/${MAP}.json`), revision: 2 });
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('The files changed on disk after this page loaded them.')).toBeVisible();
  await expect(page.getByText('unsaved changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  expect(dataExists(`editor/${MAP}.work.json`)).toBe(false);
});

test('copies the files it replaces into data/.backups, and writes nothing when nothing changed', async ({ page }) => {
  await addCallout(page, 'Backed');
  await page.getByLabel('One line on where it is, relative to what a beginner knows').fill('A thing.');
  await smallBrush(page);
  await dragOver(page, [[50, 50], [150, 50]]);
  await save(page);
  expect(backupCount()).toBe(1); // the empty callout list that was replaced
  await page.getByLabel('Aliases, separated by commas (typed answers)').fill('Back, Bk');
  await page.getByLabel('Name', { exact: true }).focus();
  await save(page);
  expect(backupCount()).toBe(2);
  // saving again with nothing changed writes nothing and adds no backup
  await page.getByLabel('Name', { exact: true }).fill('Backed');
  await page.keyboard.press('Control+s');
  expect(backupCount()).toBe(2);
  expect(readData<SavedCallout[]>(`callouts/${MAP}.json`)[0]).toMatchObject({ id: 'grid.backed' });
});

test('zones can be added, renamed, reordered and removed, and a zone in use cannot be removed', async ({ page }) => {
  await tab(page, 'Zones');
  await page.getByLabel('New zone name').fill('Middle');
  await page.getByRole('button', { name: 'Add zone' }).click();
  await expect(page.getByLabel('Name of zone middle')).toHaveValue('Middle');
  await page.getByRole('button', { name: 'Move Middle earlier' }).click();
  await page.getByLabel('Name of zone middle').fill('Centre');
  await page.getByLabel('Name of zone middle').blur();
  await addCallout(page, 'In West', 'West');
  await tab(page, 'Zones');
  await page.getByRole('button', { name: 'Remove West' }).click();
  await expect(page.getByText('callouts are still in this zone; move them first')).toBeVisible();
  await page.getByRole('button', { name: 'Remove East' }).click();
  await save(page);
  expect(readData<{ zones: { id: string; name: string }[] }>(`maps/${MAP}.json`).zones).toEqual([
    { id: 'west', name: 'West' },
    { id: 'middle', name: 'Centre' },
  ]);
});

test('the Check tab lists what is unfinished and what the content validator would reject', async ({ page }) => {
  await addCallout(page, 'Lonely');
  await smallBrush(page);
  await dragOver(page, [[50, 50], [150, 50]]);
  await page.getByLabel('One line on where it is, relative to what a beginner knows').fill('A bit.');
  await page.getByLabel('Name', { exact: true }).focus();
  await tab(page, 'Check');
  // finished but with no shots yet: the same warning pnpm content:validate gives
  await expect(page.getByText(/shot/i).first()).toBeVisible();
  await addCallout(page, 'Pending');
  await tab(page, 'Check');
  await expect(page.getByText('not in the content file yet: no region yet: paint or draw one')).toBeVisible();
});

test('the canvas can be zoomed and panned and the zoom stays within the map', async ({ page }) => {
  const svg = page.locator('svg[aria-label="Map editor canvas"]');
  const before = await svg.getAttribute('viewBox');
  const [x, y] = await screenAt(page, 400, 200);
  await page.mouse.move(x, y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -400);
  await expect.poll(async () => svg.getAttribute('viewBox')).not.toBe(before);
  const zoomed = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  expect(zoomed[2]!).toBeLessThan(Number(before!.split(' ')[2]));
  // pan with the middle button
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 80, y + 40, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const panned = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  expect(panned[0]).not.toBe(zoomed[0]);
});
