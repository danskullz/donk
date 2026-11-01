// Helpers for the Editor's browser tests. The fixture is a flat grid map ("de_grid"): areas are 100-unit squares,
// x 0-800 and y 0-400, with one column (x 400-500) cut into half-height areas. World (x, y) maps to the radar
// pixel ((x + 1000) / 2, (1000 - y) / 2) for the fixture's projection, and from there to the screen.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { FIXTURE_DATA, writeFixture } from '../scripts/editor-fixture.mjs';
import { makeGridMap, makeGridMesh } from '../src/core/editor/test-fixtures';

export const MAP = 'de_grid';

export function resetFixture(): void {
  writeFixture(makeGridMesh({ cols: 8, rows: 4, halfFrom: 4, halfCols: 1 }).mesh, makeGridMap());
}

export const dataPath = (...parts: string[]) => path.join(FIXTURE_DATA, ...parts);
export const readData = <T = unknown>(rel: string): T => JSON.parse(readFileSync(dataPath(rel), 'utf8')) as T;
export const writeData = (rel: string, value: unknown) => writeFileSync(dataPath(rel), `${JSON.stringify(value, null, 2)}\n`);
export const dataExists = (rel: string) => existsSync(dataPath(rel));
export const backupCount = () => (existsSync(dataPath('.backups', MAP)) ? readdirSync(dataPath('.backups', MAP)).length : 0);

const canvas = (page: Page) => page.locator('svg[aria-label="Map editor canvas"]');

export async function openEditor(page: Page): Promise<void> {
  await page.goto(`/#/editor/${MAP}`);
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByText('all saved')).toBeVisible();
}

/** Screen position of a world point on the canvas. */
export async function screenAt(page: Page, x: number, y: number): Promise<[number, number]> {
  return page.evaluate(
    ([wx, wy]) => {
      const svg = document.querySelector('svg[aria-label="Map editor canvas"]') as SVGSVGElement;
      const p = new DOMPoint((wx! + 1000) / 2, (1000 - wy!) / 2).matrixTransform(svg.getScreenCTM() as DOMMatrix);
      return [p.x, p.y] as [number, number];
    },
    [x, y] as const,
  );
}

export async function dragOver(page: Page, points: [number, number][]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const [sx, sy] = await screenAt(page, first[0], first[1]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (const p of rest) {
    const [x, y] = await screenAt(page, p[0], p[1]);
    await page.mouse.move(x, y, { steps: 6 });
  }
  await page.mouse.up();
}

export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const [sx, sy] = await screenAt(page, x, y);
  await page.mouse.click(sx, sy);
}

export async function tab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

export async function chooseTool(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
}

export async function addCallout(page: Page, name: string, zone = 'West', tier = '2'): Promise<void> {
  await tab(page, 'Callouts');
  await page.getByLabel('New callout name').fill(name);
  await page.getByLabel('Zone of the new callout').selectOption({ label: zone });
  await page.getByLabel('Tier of the new callout').selectOption(tier);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
}

export async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved/)).toBeVisible();
  await expect(page.getByText('all saved')).toBeVisible();
}

/** Narrow the brush to about 20 units, so a stroke along a row of areas touches only that row. */
export async function smallBrush(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) await page.keyboard.press('[');
}

export const corners = (polygon: number[][]) => polygon.map(([x, y]) => `${x},${y}`).sort();
