import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectFits, play, ready, savedEvents, seedVeteran, snapshot } from './support';
import type { ViewSnapshot } from '../src/screens/session/test-hook';

const SESSION = '/?seed=1#/session/de_test';
const MODES = ['name-mc', 'read-map', 'which-view', 'pin', 'name-typed', 'where-am-i'];

async function press(page: Page, key: string) {
  await page.keyboard.press(key);
}

async function waitForQuestion(page: Page): Promise<ViewSnapshot> {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __callouts?: { snapshot: () => { phase: string } | null } }).__callouts?.snapshot();
    return s?.phase === 'question';
  });
  return (await snapshot(page)) as ViewSnapshot;
}

test.describe('a first session', () => {
  test('introduces four callouts, quizzes on them, and ends with a summary', async ({ page }) => {
    await page.goto(SESSION);
    const phases: string[] = [];
    const final = await play(page, { onStep: async (s) => void phases.push(`${s.phase}${s.mode ? `:${s.mode}` : ''}`) });

    expect(phases.slice(0, 4)).toEqual(['intro', 'intro', 'intro', 'intro']);
    const quizzes = phases.filter((p) => p.startsWith('question'));
    expect(quizzes).toEqual(Array(4).fill('question:name-mc'));
    expect(final).toMatchObject({ phase: 'done', summary: { answered: 4, correct: 4, finished: true } });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('4 / 4');
    await expect(page.getByRole('button', { name: 'Another round' })).toBeVisible();
  });

  test('saves every event as it happens, and the next session carries on from there', async ({ page }) => {
    await page.goto(SESSION);
    const first: string[] = [];
    await play(page, { onStep: async (s) => void (s.phase === 'intro' && first.push(s.target?.id ?? '')) });
    const saved = await savedEvents(page);
    expect(saved.filter((e) => e.kind === 'intro')).toHaveLength(4);
    const answers = saved.filter((e) => e.kind === 'answer');
    expect(answers).toHaveLength(4);
    expect(answers.every((e) => e.kind === 'answer' && e.correct && e.mode === 'name-mc' && e.chosen === null)).toBe(true);
    expect(new Set(saved.map((e) => e.id)).size).toBe(8);

    // a reload starts a new session from the stored log: the callouts already met are not introduced again
    await page.reload();
    const again = await ready(page);
    expect(again.phase).toBe('intro');
    expect(first).not.toContain(again.target?.id);
    const later: string[] = [];
    await play(page, { onStep: async (s) => void (s.phase === 'question' && later.push(s.mode ?? '')) });
    // the older callouts come back with their other recognition modes; only the new one is asked Name it straight away
    expect(later.every((m) => ['name-mc', 'read-map', 'which-view'].includes(m))).toBe(true);
    expect(later.length).toBeGreaterThan(1);
  });

  test('"Another round" starts the next session', async ({ page }) => {
    await page.goto(SESSION);
    await play(page);
    await page.getByRole('button', { name: 'Another round' }).click();
    const snap = await ready(page);
    expect(snap.phase).toBe('intro');
    expect(snap.progress.total).toBeGreaterThan(0);
  });
});

test.describe('during a question', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SESSION);
    for (let i = 0; i < 4; i++) {
      await ready(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForTimeout(20);
    }
  });

  test('keys 1 to 3 answer at once, and Space moves on after the reveal', async ({ page }) => {
    const q = await waitForQuestion(page);
    expect(q.options).toHaveLength(3);
    const right = q.options.findIndex((o) => o.id === q.target?.id);
    await press(page, String(right + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    expect((await snapshot(page))?.result).toMatchObject({ correct: true });
    await page.waitForTimeout(350);
    await press(page, 'Space');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('question');
  });

  test('a hint costs a rating step and is recorded; skip is a wrong answer with nothing chosen', async ({ page }) => {
    await waitForQuestion(page);
    await press(page, 'h');
    await expect(page.locator('.hintline')).toBeVisible();
    await expect(page.getByRole('button', { name: /^hint/ })).toBeDisabled();
    await press(page, 's');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    expect((await snapshot(page))?.result).toMatchObject({ correct: false, skipped: true, chosen: null });
    await expect(page.locator('.verdict .eyebrow').first()).toHaveText('Skipped');

    const answers = (await savedEvents(page)).filter((e) => e.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ correct: false, hint: true, chosen: null, rating: 1 });
  });

  test('a wrong answer shows what was chosen, and the log keeps it', async ({ page }) => {
    const q = await waitForQuestion(page);
    const wrong = q.options.findIndex((o) => o.id !== q.target?.id);
    await press(page, String(wrong + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    await expect(page.locator('.verdict .miss')).toBeVisible();
    await expect(page.locator('.verdict .answer')).toHaveText(q.target?.name ?? '');
    const answers = (await savedEvents(page)).filter((e) => e.kind === 'answer');
    expect(answers[0]).toMatchObject({ correct: false, chosen: q.options[wrong]?.id, rating: 1 });
  });

  test('Escape ends the session at once and keeps what was answered', async ({ page }) => {
    const q = await waitForQuestion(page);
    await press(page, String(q.options.findIndex((o) => o.id === q.target?.id) + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    await press(page, 'Escape');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('done');
    expect((await snapshot(page))?.summary).toMatchObject({ answered: 1, finished: false });
    await expect(page.getByText('everything is saved')).toBeVisible();
    await expect.poll(async () => (await savedEvents(page)).filter((e) => e.kind === 'answer').length).toBe(1);
  });

  test('the progress bar and the counter follow the cards', async ({ page }) => {
    await waitForQuestion(page);
    await expect(page.locator('.bar .nums').first()).toHaveText('1 / 4');
    await expect(page.locator('.seg i')).toHaveCount(4);
    await expect(page.locator('.seg i.c')).toHaveCount(1);
  });
});

test.describe('a learner with a history', () => {
  test('every mode can be played, answered by click, key and typing, and the log reflects each answer', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    const seen = new Set<string>();
    let sawSuggestions = false;
    await play(page, {
      onStep: async (s) => {
        if (s.phase !== 'question' || !s.mode) return;
        seen.add(s.mode);
        if (s.mode === 'name-typed' && !sawSuggestions && (await page.getByText('suggestions on').count()) > 0) {
          // the bridge: suggestions are offered on the first typed question of an item, and Tab completes the first
          const field = page.locator('.field input');
          await field.fill((s.target?.name ?? 'a').slice(0, 1));
          await expect(page.locator('.sugg .sug').first()).toBeVisible();
          expect(await page.locator('.sugg .sug').count()).toBeLessThanOrEqual(5);
          await press(page, 'Tab');
          expect((await field.inputValue()).length).toBeGreaterThan(1);
          sawSuggestions = true;
        }
      },
    });
    expect([...seen].sort()).toEqual([...MODES].sort());
    expect(sawSuggestions).toBe(true);

    const answers = (await savedEvents(page)).filter((e) => e.kind === 'answer' && !e.id.startsWith('seed-'));
    expect(answers).toHaveLength(20);
    expect(answers.every((e) => e.kind === 'answer' && e.correct)).toBe(true);
  });

  test('typed answers: a one-letter slip is accepted and shows the spelling; a wrong name is wrong', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    let slip = false;
    let wrong = false;
    await play(page, {
      maxSteps: 120,
      onStep: async (s) => {
        if (s.phase !== 'question' || s.mode !== 'name-typed' || !s.target) return;
        const field = page.locator('.field input');
        const name = s.target.name;
        if (!slip && name.length >= 4) {
          await field.fill(name.slice(0, -1) + (name.endsWith('x') ? 'y' : 'x'));
          await press(page, 'Enter');
          await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
          expect((await snapshot(page))?.result).toMatchObject({ correct: true, fuzzy: true });
          await expect(page.locator('.verdict .eyebrow').first()).toHaveText('Correct · check the spelling');
          slip = true;
          return true;
        } else if (!wrong && slip) {
          await field.fill('Nowhere Near');
          await press(page, 'Enter');
          await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
          expect((await snapshot(page))?.result).toMatchObject({ correct: false, chosen: null });
          await expect(page.locator('.verdict .miss .nm')).toHaveText('Nowhere Near');
          wrong = true;
          return true;
        }
      },
    });
    expect(slip && wrong).toBe(true);
  });

  test('a pin on the next region is close, and still wrong', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    let checked = false;
    await play(page, {
      onStep: async (s) => {
        if (checked || s.phase !== 'question' || s.mode !== 'pin' || !s.target) return;
        // the map is drawn from the same data, so a neighbour's region is the one next door
        const names = await page.locator('path.rg[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
        const other = names.find((n) => n !== s.target?.name);
        await page.locator(`path.rg[aria-label="${other}"]`).click();
        await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
        const result = (await snapshot(page))?.result;
        expect(result?.correct).toBe(false);
        expect(result?.chosen).not.toBeNull();
        await expect(page.locator('.verdict .miss')).toBeVisible();
        await expect(page.locator('.guessline')).toHaveCount(1);
        checked = true;
        return true;
      },
    });
    expect(checked).toBe(true);
  });
});

// Every screen fits its window (SCOPE §5.3 rule 9): the veteran session visits every mode, its question and its reveal,
// the intro, and the end. Screenshots of each first sight are kept when SHOTS names a folder, for looking at.
const MATRIX = [
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

for (const [width, height] of MATRIX) {
  test(`no screen scrolls or overflows at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedVeteran(page);
    await page.goto(SESSION);
    // SHOTS is the folder to write into; Playwright empties test-results at the start of every run, so not there
    const shots = process.env.SHOTS ? `${process.env.SHOTS}/${width}x${height}` : null;
    if (shots) mkdirSync(shots, { recursive: true });
    const taken = new Set<string>();
    const final = await play(page, {
      onStep: async (s) => {
        const name = `${s.phase}-${s.mode ?? 'none'}`;
        await expectFits(page, `${width}x${height} ${name} (${s.target?.name ?? ''})`);
        if (shots && !taken.has(name)) {
          taken.add(name);
          await page.screenshot({ path: `${shots}/${name}.png` });
        }
        // the open suggestions are part of the screen too
        if (s.phase === 'question' && s.mode === 'name-typed' && (await page.getByText('suggestions on').count()) > 0) {
          await page.locator('.field input').fill((s.target?.name ?? 'a').slice(0, 1));
          await expectFits(page, `${width}x${height} typed with suggestions`);
          if (shots && !taken.has('typed-suggestions')) {
            taken.add('typed-suggestions');
            await page.screenshot({ path: `${shots}/typed-suggestions.png` });
          }
        }
      },
    });
    await expectFits(page, `${width}x${height} done`);
    if (shots) await page.screenshot({ path: `${shots}/done-final.png` });
    expect(final.phase).toBe('done');
  });
}

// A phone in portrait with the soft keyboard open leaves about 340 px: the typed question has its own layout for it
// (SCOPE §5.3 rule 6): the suggestions open upward over the screenshot and the footer gives way.
test('the typed question fits with the keyboard open (360x340), suggestions included', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 340 });
  await seedVeteran(page);
  await page.goto(SESSION);
  let checked = false;
  await play(page, {
    maxSteps: 80,
    onStep: async (s) => {
      if (checked || s.phase !== 'question' || s.mode !== 'name-typed' || (await page.getByText('suggestions on').count()) === 0) return;
      await expectFits(page, 'typed, empty field');
      await page.locator('.field input').fill((s.target?.name ?? 'a').slice(0, 1));
      await expect(page.locator('.sugg .sug').first()).toBeVisible();
      await expectFits(page, 'typed, suggestions open');
      // upward: the list sits above the field
      const field = await page.locator('.field').boundingBox();
      const list = await page.locator('.sugg').boundingBox();
      expect(list && field && list.y + list.height <= field.y + 1).toBe(true);
      checked = true;
    },
  });
  expect(checked).toBe(true);
});

test.describe('first-time and empty states', () => {
  test('a first session fits too, intro included', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(SESSION);
    await play(page, { onStep: async (s) => expectFits(page, `first session ${s.phase}`) });
  });

  test('an unknown map says so and offers the way back', async ({ page }) => {
    await page.goto('/#/session/de_nowhere');
    await expect(page.getByRole('heading', { name: 'No such map' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the start' })).toBeVisible();
  });

  test('a map with nothing playable ends at once with an explanation (Mirage has no callouts yet)', async ({ page }) => {
    await page.goto('/#/session/de_mirage');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing to do');
    await expect(page.getByText('This map has no callouts to learn yet.')).toBeVisible();
    await expectFits(page, 'empty map');
  });
});

test('the session screen has no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await seedVeteran(page);
  await page.goto(SESSION);
  await play(page);
  expect(errors).toEqual([]);
});
