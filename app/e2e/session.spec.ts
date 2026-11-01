import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { answerQuestion, CONTRAST_SEEN_KEY, expectFits, lastSession, play, ready, savedEvents, seedConfusions, seedMastered, seedVeteran, snapshot, waitForView } from './support';
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


// ---------------------------------------------------------------------------------------------------------------------
// Speed call, contrast cards, early practice, the settings that shape a session, and the hand-off to the Summary.
// These need learners with a particular history; the seeds are in support.ts. `?flash=` (development and e2e builds
// only) fixes how long a Speed call picture shows, so a test can be quick or can look at the flash.
// ---------------------------------------------------------------------------------------------------------------------

const speedUrl = (flashMs: number) => `/?seed=1&flash=${flashMs}#/session/de_test`;

/** Settings the way the Settings screen stores them; they are read when a session starts. */
async function withSettings(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((value) => localStorage.setItem('callouts.settings', JSON.stringify(value)), settings);
}

function pictureFolder(width: number, height: number): string | null {
  if (!process.env.SHOTS) return null;
  const dir = `${process.env.SHOTS}/${width}x${height}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const answersOf = async (page: Page) => (await savedEvents(page)).filter((e) => e.kind === 'answer' && !e.id.startsWith('seed-'));

test.describe('speed call', () => {
  test('the picture flashes, hides, and then four names can be chosen; the answer is timed from the hide', async ({ page }) => {
    await seedMastered(page);
    await page.goto(speedUrl(2500));
    const q = await waitForView(page, 'question', 'speed');
    expect(q).toMatchObject({ flashing: true, flashMs: 2500 });
    expect(q.options).toHaveLength(4);

    // while the picture is up: it, the one countdown, and nothing to choose yet
    await expect(page.locator('.speed-shot img')).toBeVisible();
    await expect(page.locator('.speed-count')).toHaveText(/^\d\.\d s$/);
    await expect(page.locator('.speed-bar i')).toHaveCSS('animation-duration', '2.5s');
    await expect(page.locator('.opts')).toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: /^hint/ })).toBeDisabled();
    await press(page, '1');
    await press(page, 'h');
    expect(await snapshot(page)).toMatchObject({ phase: 'question', flashing: true, hint: null });
    await expect(page.locator('.sr-only[role="status"]')).toContainText('Look at the picture');

    // then it is gone, the plate keeps its size, and the choices open
    await expect.poll(async () => (await snapshot(page))?.flashing, { timeout: 8000 }).toBe(false);
    await expect(page.locator('.speed-shot img')).toHaveCount(0);
    await expect(page.locator('.speed-count, .speed-bar')).toHaveCount(0);
    await expect(page.locator('.opts')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.sr-only[role="status"]')).toContainText('The picture is gone');

    const right = q.options.findIndex((o) => o.id === q.target?.id);
    await press(page, String(right + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    expect((await snapshot(page))?.result).toMatchObject({ correct: true });
    await expect.poll(async () => (await answersOf(page)).length).toBe(1);
    const [saved] = await answersOf(page);
    expect(saved).toMatchObject({ mode: 'speed', correct: true, hint: false, chosen: null });
    // timed from the hide: the picture alone took 2.5 s, which an answer timed from its appearance could not beat
    expect(saved?.kind === 'answer' && saved.latencyMs).toBeLessThan(2500);
  });

  test('"I don\'t know" is allowed while the picture is up, and is a wrong answer with nothing chosen', async ({ page }) => {
    await seedMastered(page);
    await page.goto(speedUrl(6000));
    await waitForView(page, 'question', 'speed');
    await expect(page.locator('.speed-shot img')).toBeVisible();
    await press(page, 's');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    expect((await snapshot(page))?.result).toMatchObject({ correct: false, skipped: true, chosen: null });
    await expect.poll(async () => (await answersOf(page)).length).toBe(1);
    expect((await answersOf(page))[0]).toMatchObject({ mode: 'speed', correct: false, chosen: null, rating: 1 });
  });

  test('a hint (the first letter) comes once the picture is gone, and is recorded', async ({ page }) => {
    await seedMastered(page);
    await page.goto(speedUrl(300));
    await waitForView(page, 'question', 'speed');
    await expect.poll(async () => (await snapshot(page))?.flashing).toBe(false);
    await press(page, 'h');
    await expect(page.locator('.hintline')).toContainText('starts with');
    await expect(page.locator('.opt.ruled').first()).toBeVisible();
    const q = (await snapshot(page)) as ViewSnapshot;
    await answerQuestion(page, q);
    await expect.poll(async () => (await answersOf(page)).length).toBe(1);
    expect((await answersOf(page))[0]).toMatchObject({ mode: 'speed', hint: true, correct: true });
  });

  test('with reduced motion (the browser asks) the picture stays for its whole time and nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedMastered(page);
    await page.goto(speedUrl(2400));
    await waitForView(page, 'question', 'speed');
    await expect(page.locator('.speed-shot img')).toBeVisible();
    await expect(page.locator('.speed-bar')).toHaveCount(0);
    await expect(page.locator('.speed-count')).toHaveText(/^\d s$/);
    await page.waitForTimeout(1100);
    // more than a third of the way through, the picture is still up: nothing faded it out
    expect(await snapshot(page)).toMatchObject({ flashing: true });
    await expect(page.locator('.speed-shot img')).toBeVisible();
    await expect.poll(async () => (await snapshot(page))?.flashing, { timeout: 6000 }).toBe(false);
    await expect(page.locator('.speed-shot img')).toHaveCount(0);
  });

  test('with reduced motion switched on in Settings the same holds, whatever the browser says', async ({ page }) => {
    await withSettings(page, { reducedMotion: 'on' });
    await seedMastered(page);
    await page.goto(speedUrl(1500));
    await waitForView(page, 'question', 'speed');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
    await expect(page.locator('.speed-bar')).toHaveCount(0);
    await expect(page.locator('.speed-count')).toHaveText(/^\d s$/);
  });

  test('with reduced motion switched off in Settings the countdown bar is drawn, even if the browser asks for less', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withSettings(page, { reducedMotion: 'off' });
    await seedMastered(page);
    await page.goto(speedUrl(1500));
    await waitForView(page, 'question', 'speed');
    await expect(page.locator('.speed-bar i')).toBeVisible();
    await expect(page.locator('.speed-count')).toHaveText(/^\d\.\d s$/);
  });

  test('no other screen counts down: only a Speed call has a clock', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    await play(page, { onStep: async () => void (await expect(page.locator('.speed-bar, .speed-count')).toHaveCount(0)) });
  });

  test('a session of Speed calls plays through; the new-item cap keeps the rest for next time', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await seedMastered(page);
    await page.goto(speedUrl(300));
    const modes: string[] = [];
    const final = await play(page, { onStep: async (s) => void (s.phase === 'question' && modes.push(s.mode ?? '')) });
    // Speed call is one of the default modes, opened by Where am I? being stable for 21 days; 30 % of 20 cards is 6
    expect(modes).toEqual(Array(6).fill('speed'));
    expect(final.summary).toMatchObject({ finished: true, answered: 6, correct: 6 });
    await expect.poll(async () => (await answersOf(page)).length).toBe(6);
    expect((await answersOf(page)).every((e) => e.kind === 'answer' && e.mode === 'speed' && e.correct)).toBe(true);

    await page.reload();
    const again = await ready(page);
    expect(again).toMatchObject({ phase: 'question', mode: 'speed', progress: { total: 2 } });
    expect(errors).toEqual([]);
  });

  test('a learner who has not reached the Place stage is never asked one', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(speedUrl(300));
    const modes = new Set<string>();
    await play(page, { onStep: async (s) => void (s.mode && modes.add(s.mode)) });
    expect(modes.has('speed')).toBe(false);
  });
});

test.describe('contrast cards', () => {
  test('a pair mixed up twice gets one card, side by side with nothing to answer, then a Which view? question for it', async ({ page }) => {
    const { target, other } = await seedConfusions(page);
    await page.goto(SESSION);
    const card = await ready(page);
    expect(card).toMatchObject({ phase: 'contrast', target: { id: target, name: 'A Ramp' }, other: { id: other, name: 'Mid' }, options: [] });

    await expect(page.locator('.c-col')).toHaveCount(2);
    await expect(page.locator('.c-col .shot img')).toHaveCount(2);
    await expect(page.locator('.c-name')).toHaveText(['A Ramp', 'Mid']);
    await expect(page.locator('.c-col .blurb')).toHaveText(['A Ramp in the test map.', 'Mid in the test map.']);
    await expect(page.locator('.c-col').first().locator('.chip')).toHaveText(['Mid', 'A Site']);
    await expect(page.locator('.c-col').nth(1).locator('.chip')).toHaveText(['T Spawn', 'A Ramp', 'Connector', 'B Site']);
    await expect(page.locator('.c-head .eyebrow')).toContainText('Mixed up 3 times');
    await expect(page.locator('.opt, .view, .field')).toHaveCount(0);
    await expect(page.locator('.bar .nums').first()).toHaveText('compare');
    await expect(page.locator('.foot').getByRole('button', { name: 'Continue' })).toBeFocused();
    await expect(page.locator('.sr-only[role="status"]')).toContainText('Mixed up 3 times');
    // a card is read, not answered: nothing is logged for it
    expect(await answersOf(page)).toHaveLength(0);

    await page.getByRole('button', { name: 'Continue' }).click();
    const q = await waitForView(page, 'question', 'which-view');
    expect(q.target?.id).toBe(target);
    expect(q.options.map((o) => o.id)).toContain(other);
    await expect(page.locator('.prompt .big')).toHaveText('Which view is A Ramp?');
    // remembered beside the log (not in it), so the pair rests for a week
    const seen = await page.evaluate((key) => localStorage.getItem(key), CONTRAST_SEEN_KEY);
    expect(JSON.parse(seen ?? '{}')).toHaveProperty(['test.a-ramp|test.mid', 'count'], 3);
    expect(await answersOf(page)).toHaveLength(0);

    const right = q.options.findIndex((o) => o.id === target);
    await press(page, String(right + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    await expect.poll(async () => (await answersOf(page)).length).toBe(1);
  });

  test('Space moves on from the card, after a short guard against a double press', async ({ page }) => {
    await seedConfusions(page);
    await page.goto(SESSION);
    await ready(page);
    await page.waitForTimeout(350);
    await press(page, 'Space');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('question');
  });

  test('the same pair is not shown again within a week, even if it is mixed up again', async ({ page }) => {
    await seedConfusions(page);
    await page.goto(SESSION);
    const q = await (async () => {
      await ready(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      return waitForView(page, 'question', 'which-view');
    })();
    // answer the wrong way round: the pair is now mixed up 4 times
    const wrong = q.options.findIndex((o) => o.id !== q.target?.id && o.id === 'test.mid');
    await press(page, String(wrong + 1));
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('reveal');
    await expect.poll(async () => (await answersOf(page)).length).toBe(1);
    await press(page, 'Escape');
    await page.reload();
    expect((await ready(page)).phase).not.toBe('contrast');
  });

  test('leaving on the card does not count it as seen: it is still there next time', async ({ page }) => {
    await seedConfusions(page);
    await page.goto(SESSION);
    await ready(page);
    await press(page, 'Escape');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('done');
    expect(await page.evaluate((key) => localStorage.getItem(key), CONTRAST_SEEN_KEY)).toBeNull();
    await page.reload();
    expect((await ready(page)).phase).toBe('contrast');
  });

  test('a whole session with a contrast card plays to the end without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await seedConfusions(page);
    await page.goto(SESSION);
    const phases: string[] = [];
    const final = await play(page, { onStep: async (s) => void phases.push(s.phase === 'question' ? `${s.phase}:${s.mode}` : s.phase) });
    expect(phases.slice(0, 3)).toEqual(['contrast', 'question:which-view', 'reveal']);
    expect(phases.filter((p) => p === 'contrast')).toHaveLength(1);
    expect(final.phase).toBe('done');
    expect(errors).toEqual([]);
  });
});

test.describe('early practice', () => {
  test('when nothing is due the end screen offers "Practise anyway": the items closest to due, flagged as early', async ({ page }) => {
    await seedMastered(page, { speed: 'asked' });
    await page.goto(speedUrl(300));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing to do');
    await expect(page.getByText('You can practise the items closest to due.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Practise anyway' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Another round' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Full summary' })).toHaveCount(0);
    await expectFits(page, 'nothing due, early practice offered');

    await page.getByRole('button', { name: 'Practise anyway' }).click();
    const first = await waitForView(page, 'question');
    expect(first.progress.total).toBe(20);
    await expect(page.locator('.bar .chip')).toHaveText('early practice');
    const modes = new Set<string>();
    const final = await play(page, { onStep: async (s) => void (s.mode && modes.add(s.mode)) });
    expect(final.summary).toMatchObject({ earlyPractice: true, finished: true, answered: 20, correct: 20, endedBy: 'plan' });
    expect(modes.size).toBeGreaterThan(2);
    await expect(page.locator('.done-main .eyebrow')).toHaveText('Early practice complete');
    await expect(page.getByText('nothing here was due yet', { exact: false })).toBeVisible();

    // each early answer is a normal answer in the log; no intro was logged, nothing new was taught
    await expect.poll(async () => (await answersOf(page)).length).toBe(20);
    expect((await savedEvents(page)).filter((e) => e.kind === 'intro' && !e.id.startsWith('seed-'))).toHaveLength(0);
    expect((await lastSession(page))?.summary.earlyPractice).toBe(true);
  });

  test('"Another round" after early practice carries on with early practice, not with an ordinary (empty) session', async ({ page }) => {
    await seedMastered(page, { speed: 'asked' });
    await page.goto(speedUrl(300));
    await page.getByRole('button', { name: 'Practise anyway' }).click();
    await answerQuestion(page, await waitForView(page, 'question'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await press(page, 'Escape');
    await waitForView(page, 'done');
    await expect(page.getByText('Session ended early')).toBeVisible();
    await page.getByRole('button', { name: 'Another round' }).click();
    await waitForView(page, 'question');
    await expect(page.locator('.bar .chip')).toHaveText('early practice');
  });

  test('is not offered to a learner with nothing started, or on a map with no callouts', async ({ page }) => {
    await page.goto('/#/session/de_mirage');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing to do');
    await expect(page.getByRole('button', { name: 'Practise anyway' })).toHaveCount(0);
  });

  test('is not offered while something is due', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    expect((await ready(page)).phase).toBe('question');
    await press(page, 'Escape');
    await expect.poll(async () => (await snapshot(page))?.phase).toBe('done');
    await expect(page.getByRole('button', { name: 'Practise anyway' })).toHaveCount(0);
  });
});

test.describe('the settings that shape a session', () => {
  test('new per session and the gentle start', async ({ page }) => {
    await withSettings(page, { newPerSession: 2, gentleStart: false });
    await page.goto(SESSION);
    const phases: string[] = [];
    const counts: number[] = [];
    await play(page, {
      onStep: async (s) => {
        phases.push(s.phase);
        if (s.phase === 'question') counts.push(s.options.length);
      },
    });
    expect(phases.filter((p) => p === 'intro')).toHaveLength(2);
    expect(counts).toEqual([4, 4]);
  });

  test('the card limit', async ({ page }) => {
    await withSettings(page, { sessionCards: 5 });
    await seedVeteran(page);
    await page.goto(SESSION);
    expect((await ready(page)).progress.total).toBe(5);
    const final = await play(page);
    expect(final.summary).toMatchObject({ answered: 5, finished: true });
  });

  test('Hard mode for the map brings in the Hard spots whose parent is known', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    expect((await ready(page)).phase).toBe('question'); // nothing new to teach: the Hard spot is out
    await page.evaluate(() => localStorage.setItem('callouts.settings', JSON.stringify({ hardMode: { de_test: true } })));
    await page.reload();
    const first = await ready(page);
    expect(first).toMatchObject({ phase: 'intro', target: { id: 'test.bench', name: 'Bench' } });
  });

  test('the time limit ends the session after the card on screen, and the end screen says so', async ({ page }) => {
    await seedVeteran(page);
    await withSettings(page, { sessionMinutes: 5, sessionCards: null });
    await page.clock.install();
    await page.goto(SESSION);
    const first = await ready(page);
    await answerQuestion(page, first);
    await waitForView(page, 'reveal');
    await page.clock.fastForward(6 * 60_000);
    await page.getByRole('button', { name: 'Continue' }).click();
    const done = await waitForView(page, 'done');
    expect(done.summary).toMatchObject({ finished: true, endedBy: 'time', answered: 1 });
    await expect(page.locator('.done-main .eyebrow')).toHaveText('Time is up, session complete');
  });

  test('a session inside its time carries on', async ({ page }) => {
    await seedVeteran(page);
    await withSettings(page, { sessionMinutes: 5, sessionCards: null });
    await page.goto(SESSION);
    await answerQuestion(page, await ready(page));
    await waitForView(page, 'reveal');
    await page.getByRole('button', { name: 'Continue' }).click();
    expect((await waitForView(page, 'question')).phase).toBe('question');
  });
});

test.describe('the hand-off to the Summary screen', () => {
  test('a finished session leaves its summary, with the names to show, and "Full summary" opens the screen', async ({ page }) => {
    await page.goto(SESSION);
    await play(page);
    const last = await lastSession(page);
    expect(last).toMatchObject({ mapId: 'de_test', note: null, playable: 8, summary: { finished: true, answered: 4, correct: 4, endedBy: 'plan', earlyPractice: false } });
    expect(last?.summary.introduced).toHaveLength(4);
    for (const id of last?.summary.introduced ?? []) expect(last?.names[id]).toBeTruthy();
    await page.getByRole('button', { name: 'Full summary' }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/summary/de_test');
  });

  test('Escape hands over an unfinished session', async ({ page }) => {
    await page.goto(SESSION);
    await ready(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await press(page, 'Escape');
    await waitForView(page, 'done');
    expect(await lastSession(page)).toMatchObject({ mapId: 'de_test', summary: { finished: false, endedBy: 'left', answered: 0 } });
  });

  test('walking away mid-session hands it over too', async ({ page }) => {
    await seedVeteran(page);
    await page.goto(SESSION);
    await answerQuestion(page, await ready(page));
    await waitForView(page, 'reveal');
    expect(await lastSession(page)).toBeNull();
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await expect.poll(async () => (await lastSession(page))?.summary.answered).toBe(1);
    expect(await lastSession(page)).toMatchObject({ summary: { finished: false, endedBy: 'left' } });
  });

  test('opening a session and leaving at once leaves the last real summary alone', async ({ page }) => {
    await page.goto(SESSION);
    await play(page);
    const before = await lastSession(page);
    expect(before).not.toBeNull();
    await page.getByRole('button', { name: 'Another round' }).click();
    await waitForView(page, 'intro');
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/settings');
    expect(await lastSession(page)).toEqual(before);
  });

  test('a map with nothing playable hands over an honest empty summary', async ({ page }) => {
    await page.goto('/#/session/de_mirage');
    await waitForView(page, 'done');
    expect(await lastSession(page)).toMatchObject({ mapId: 'de_mirage', playable: 0, note: 'nothing-due', summary: { answered: 0, finished: true } });
  });
});

// Speed call and the contrast card are new screens: they fit every window like the others (SCOPE §5.3 rule 9).
for (const [width, height] of MATRIX) {
  test(`the speed call fits at ${width}x${height}: picture up, picture gone, and the reveal`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedMastered(page);
    await page.goto(speedUrl(3500));
    const dir = pictureFolder(width, height);
    await waitForView(page, 'question', 'speed');
    await expect(page.locator('.speed-shot img')).toBeVisible();
    await expectFits(page, `${width}x${height} speed call, picture up`);
    if (dir) await page.screenshot({ path: `${dir}/speed-up.png` });
    await expect.poll(async () => (await snapshot(page))?.flashing, { timeout: 8000 }).toBe(false);
    await expectFits(page, `${width}x${height} speed call, picture gone`);
    if (dir) await page.screenshot({ path: `${dir}/speed-gone.png` });
    await answerQuestion(page, (await snapshot(page)) as ViewSnapshot);
    await waitForView(page, 'reveal');
    await expectFits(page, `${width}x${height} speed call reveal`);
  });

  test(`the contrast card fits at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedConfusions(page);
    await page.goto(SESSION);
    await waitForView(page, 'contrast');
    await expectFits(page, `${width}x${height} contrast card`);
    const dir = pictureFolder(width, height);
    if (dir) await page.screenshot({ path: `${dir}/contrast.png` });
    // both pictures and both names are on screen, whatever the shape of the window
    for (const name of ['A Ramp', 'Mid']) await expect(page.locator('.c-name', { hasText: new RegExp(`^${name}$`) })).toBeVisible();
    await expect(page.locator('.c-col .shot img')).toHaveCount(2);
    await page.getByRole('button', { name: 'Continue' }).click();
    await waitForView(page, 'question', 'which-view');
    await expectFits(page, `${width}x${height} the question after the card`);
  });
}

test('the end screen of early practice fits every window', async ({ page }) => {
  await seedMastered(page, { speed: 'asked' });
  for (const [width, height] of MATRIX) {
    await page.setViewportSize({ width, height });
    await page.goto(speedUrl(300));
    await expect(page.getByRole('button', { name: 'Practise anyway' })).toBeVisible();
    await expectFits(page, `${width}x${height} nothing due, early practice offered`);
  }
});
