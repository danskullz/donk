<script lang="ts">
  // Progress: the long view (SCOPE.md §5.1, §4.5, §4.6). Small multiples on one screen: mastery per map, the pairs you mix
  // up most, how fast you answer week by week, and a heat-grid of answers per day. It reads the whole review log and
  // never writes to it. Everything it computes is in core/stats.ts (and `mapProgress`, so the percent here is the one on
  // Home); this file arranges it. Development and e2e builds also hold the synthetic map's log, shown apart and labelled.
  import '../styles/study.css';
  import '../styles/progress.css';
  import { loadAvailableMaps, type MapData } from '../app/data';
  import { includeDraftFor, mapProgress, type MapProgress } from '../app/progress';
  import { getSettings, hardModeFor } from '../app/settings';
  import { replay, type Derived, type ReviewEvent } from '../core/log';
  import { displayName } from '../core/naming';
  import { createScheduler, type Scheduler } from '../core/scheduler';
  import type { Callout } from '../core/schema';
  import {
    dayLabel,
    heatGrid,
    heatLayout,
    mapConfusions,
    pageWindow,
    percent,
    secondsText,
    sparkline,
    speedTrend,
    totals,
    weeklyLatency,
    weeksText,
  } from '../core/stats';
  import { DAY_MS, MASTERY_STATES, type Mastery } from '../core/types';
  import { DB_NAME, DEMO_DB_NAME, readEvents } from '../storage/idb-store';

  const LABEL: Record<Mastery, string> = { new: 'New', seen: 'Seen', learning: 'Learning', familiar: 'Familiar', known: 'Known', automatic: 'Automatic' };
  const WEEKS_SHOWN = 26;
  const WEEKS_SPEED = 12;
  const WEEKDAYS = [
    { row: 0, text: 'Mon' },
    { row: 2, text: 'Wed' },
    { row: 4, text: 'Fri' },
  ];

  interface Log {
    events: ReviewEvent[];
    invalid: number;
    derived: Derived;
    /** The file could not be read at all. */
    failed: boolean;
  }

  let boot = $state<'loading' | 'ready' | 'error'>('loading');
  let maps = $state.raw<MapData[]>([]);
  let scheduler = $state.raw<Scheduler | null>(null);
  let logs = $state.raw<{ real: Log; demo: Log | null } | null>(null);
  /** Which log is on show. Only development builds have a second one. */
  let scope = $state<'real' | 'demo'>('real');
  let now = $state(Date.now());
  /** On a phone in portrait the four panels take turns in one slot. */
  let view = $state<'maps' | 'mixed' | 'speed' | 'heat'>('maps');
  let mapsPick = $state<number | null>(null);
  let mixedPick = $state<number | null>(null);
  let mapsPer = $state(0);
  let mixedPer = $state(0);
  let heatBox = $state({ w: 0, h: 0 });
  let chartBox = $state({ w: 0, h: 0 });

  /**
   * `readEvents` treats a database that was never created as empty, but it does so by aborting its creation, which the
   * `idb` library reports as an unhandled AbortError in the console. Asking the browser first keeps a first run clean.
   * Browsers that cannot list their databases go straight to `readEvents`.
   */
  async function exists(name: string): Promise<boolean> {
    try {
      const known = await indexedDB.databases?.();
      return known ? known.some((d) => d.name === name) : true;
    } catch {
      return true;
    }
  }

  async function readLog(name: string, retention: Scheduler): Promise<Log> {
    try {
      const { events, invalid } = (await exists(name)) ? await readEvents(name) : { events: [], invalid: 0 };
      return { events, invalid, derived: replay(events, retention), failed: false };
    } catch (e) {
      console.warn(`The review log "${name}" could not be read; progress shows it as empty`, e);
      return { events: [], invalid: 0, derived: replay([], retention), failed: true };
    }
  }

  $effect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await loadAvailableMaps();
        const retention = await createScheduler(getSettings().retention);
        const real = await readLog(DB_NAME, retention);
        const demo = loaded.some((m) => m.demo) ? await readLog(DEMO_DB_NAME, retention) : null;
        if (!alive) return;
        maps = loaded;
        scheduler = retention;
        logs = { real, demo };
        // With nothing of the real learner's yet, a development build opens on the synthetic log: it is all there is to see.
        scope = real.events.length === 0 && demo && demo.events.length > 0 ? 'demo' : 'real';
        now = Date.now();
        boot = 'ready';
      } catch (e) {
        console.error(e);
        if (alive) boot = 'error';
      }
    })();
    return () => {
      alive = false;
    };
  });

  function chooseScope(next: 'real' | 'demo') {
    scope = next;
    mapsPick = null;
    mixedPick = null;
  }

  const settings = getSettings();
  const naming = settings.naming;
  const log = $derived(logs ? (scope === 'demo' ? logs.demo : logs.real) : null);
  const events = $derived(log?.events ?? []);
  const scopeMaps = $derived(maps.filter((m) => m.demo === (scope === 'demo')));

  /** One row per map: how far along it is, by `mapProgress`, the same figure Home quotes. */
  const rows = $derived.by(() => {
    if (!log || !scheduler) return [];
    const sched = scheduler;
    return scopeMaps.map((m) => ({
      data: m,
      p: mapProgress({ callouts: m.callouts, derived: log.derived, scheduler: sched, now, hardMode: hardModeFor(settings, m.map.id), includeDraft: includeDraftFor(m) }),
    }));
  });
  const inPlay = $derived(new Map(rows.flatMap((r) => r.data.callouts.filter((c) => c.id in r.p.fills).map((c): [string, { callout: Callout; map: MapData }] => [c.id, { callout: c, map: r.data }]))));
  const severalMaps = $derived(rows.filter((r) => r.p.playable).length > 1);

  const sum = $derived(totals(events));
  const grid = $derived(heatGrid(events, now, WEEKS_SHOWN));
  const weeks = $derived(weeklyLatency(events, now, WEEKS_SPEED));
  const trend = $derived(speedTrend(weeks));
  const chart = $derived(sparkline(weeks.map((w) => w.medianMs), chartBox.w, chartBox.h));
  const pairs = $derived(log ? mapConfusions(log.derived, new Set(inPlay.keys()), 2) : []);

  const mapsWin = $derived(pageWindow(rows.length, mapsPer, mapsPick));
  const mixedWin = $derived(pageWindow(pairs.length, mixedPer, mixedPick));
  const shownMaps = $derived(rows.slice(mapsWin.from, mapsWin.to));
  const shownPairs = $derived(pairs.slice(mixedWin.from, mixedWin.to));
  const layout = $derived(heatLayout(heatBox.w, heatBox.h, WEEKS_SHOWN));

  /** The change in speed in words: the latest week with a right answer against the earliest in view. */
  const speedChange = $derived.by(() => {
    const { earliest, latest, changeMs } = trend;
    if (!earliest || !latest || changeMs === null) return null;
    const apart = weeksText(Math.max(1, Math.round((latest.start - earliest.start) / (7 * DAY_MS))));
    if (Math.abs(changeMs) < 50) return `About the same as ${apart} ago`;
    return `${secondsText(Math.abs(changeMs))} ${changeMs < 0 ? 'faster' : 'slower'} than ${apart} ago`;
  });

  const nameOf = (id: string): string => {
    const found = inPlay.get(id);
    return found ? displayName(found.callout, naming) : id;
  };

  const heatLabel = $derived(
    grid.total === 0
      ? `No answers in the last ${WEEKS_SHOWN} weeks.`
      : `${grid.total} answers on ${grid.activeDays} days in the last ${WEEKS_SHOWN} weeks, at most ${grid.max} in a day.`,
  );
  const chartLabel = $derived(
    trend.latest ? `Median time to a right answer per week for the last ${WEEKS_SPEED} weeks. Latest ${secondsText(trend.latest.medianMs as number)}.` : 'No right answers yet.',
  );

  /**
   * Tells the screen how many rows of a list fit its box. The stylesheet owns the height of a row (`--pg-row`) and
   * hands it over as a custom property, so the number is right on every layout; nothing in these lists scrolls.
   */
  function fitRows(node: HTMLElement, report: (rows: number) => void) {
    const measure = () => report(Math.floor(node.clientHeight / (parseFloat(getComputedStyle(node).getPropertyValue('--pg-row')) || 36)));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return { destroy: () => watch.disconnect() };
  }

  /** The size of a box, so the charts can be drawn to exactly fit it. */
  function sizeOf(node: HTMLElement, report: (box: { w: number; h: number }) => void) {
    const measure = () => report({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return { destroy: () => watch.disconnect() };
  }

  const barLabel = (name: string, p: MapProgress) =>
    `${name}: ${p.percent}% learned. ${MASTERY_STATES.filter((s) => p.states[s] > 0)
      .map((s) => `${p.states[s]} ${LABEL[s].toLowerCase()}`)
      .join(', ')}.`;
</script>

<div class="app pg">
  <header class="bar">
    <span class="brand">callouts</span>
    <span class="crumb"><a href="#/"><span class="pg-hide-s">Maps</span></a><span class="pg-hide-s"> / </span><b>Progress</b></span>
    <span class="grow"></span>
    {#if log?.failed}<span class="chip warn" title="The review log could not be read, so it is shown as empty.">log unreadable</span>{/if}
    {#if log && log.invalid > 0}<span class="chip warn" title="Stored events that do not match the schema are left out of every number here.">{log.invalid} unreadable {log.invalid === 1 ? 'event' : 'events'}</span>{/if}
    {#if logs?.demo}
      <div class="pg-scope" role="group" aria-label="Which review log">
        <button type="button" class="pg-vt" aria-pressed={scope === 'real'} onclick={() => chooseScope('real')}>Your log</button>
        <button type="button" class="pg-vt" aria-pressed={scope === 'demo'} onclick={() => chooseScope('demo')}>Development</button>
      </div>
    {/if}
  </header>

  {#if boot === 'loading'}
    <main class="pg-notice"><p class="sub">Loading</p></main>
  {:else if boot === 'error' || !log}
    <main class="pg-notice">
      <h1>Progress could not be loaded</h1>
      <p>Something is wrong with the map data. <a href="#/">Back to the start</a></p>
    </main>
  {:else}
    <main class="pg-body" data-view={view} data-empty={sum.answers === 0 ? 'true' : undefined}>
      <h1 class="sr-only">Progress</h1>

      <div class="pg-totals" aria-label="Totals">
        {#if scope === 'demo'}<span class="chip warn" title="The synthetic test map, kept in its own log so it never touches your real progress.">development data</span>{/if}
        {#if sum.answers > 0}
          <span><b>{sum.answers}</b> {sum.answers === 1 ? 'answer' : 'answers'}</span>
          <span><b>{percent(sum.correct, sum.answers)}%</b> right</span>
          <span><b>{sum.activeDays}</b> {sum.activeDays === 1 ? 'day' : 'days'} practised</span>
          <span><b>{sum.met}</b> {sum.met === 1 ? 'callout' : 'callouts'} met</span>
        {:else}
          <span>No answers yet. <a href="#/">Start a session</a> and this fills in.</span>
        {/if}
      </div>

      <div class="pg-views" role="group" aria-label="Show">
        <button type="button" class="pg-vt" aria-pressed={view === 'maps'} onclick={() => (view = 'maps')}>Maps</button>
        <button type="button" class="pg-vt" aria-pressed={view === 'mixed'} onclick={() => (view = 'mixed')}>Mixed up</button>
        <button type="button" class="pg-vt" aria-pressed={view === 'speed'} onclick={() => (view = 'speed')}>Speed</button>
        <button type="button" class="pg-vt" aria-pressed={view === 'heat'} onclick={() => (view = 'heat')}>Reviews</button>
      </div>

      <div class="pg-col a">
        <section class="pg-panel pg-maps" aria-labelledby="pg-h-maps">
          <h2 id="pg-h-maps">Mastery by map</h2>
          <div class="pg-rows" use:fitRows={(n) => (mapsPer = n)}>
            {#each shownMaps as r (r.data.map.id)}
              {@const p = r.p}
              <a class="pg-map" href="#/map/{r.data.map.id}" data-map={r.data.map.id}>
                <span class="pg-mname">{r.data.map.displayName}</span>
                {#if p.playable}
                  <span class="pg-bar" role="img" aria-label={barLabel(r.data.map.displayName, p)}>
                    {#each MASTERY_STATES as s (s)}{#if p.states[s] > 0}<i class="mgl" data-s={s} style:--n={p.states[s]} title="{LABEL[s]}: {p.states[s]}"></i>{/if}{/each}
                  </span>
                  <span class="pg-pct nums">{p.percent}%</span>
                  <span class="pg-meta sub nums">
                    {#if p.core.total > 0}<span>Core {p.core.familiar} of {p.core.total}</span>{/if}
                    {#if p.due > 0}<span class="due">{p.due} due</span>{/if}
                  </span>
                {:else}
                  <span class="pg-none sub">No callouts yet</span>
                {/if}
              </a>
            {/each}
          </div>
          <div class="pg-foot">
            {#if mapsWin.pageCount > 1}
              <button type="button" class="pg-step" aria-label="Previous page of maps" disabled={mapsWin.page <= 0} onclick={() => (mapsPick = mapsWin.page - 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" /></svg>
              </button>
              <span class="nums">{mapsWin.page + 1} / {mapsWin.pageCount}</span>
              <button type="button" class="pg-step" aria-label="Next page of maps" disabled={mapsWin.page >= mapsWin.pageCount - 1} onclick={() => (mapsPick = mapsWin.page + 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m5 2 5 5-5 5" /></svg>
              </button>
            {/if}
            <span class="pg-legend" aria-label="Mastery states">
              {#each MASTERY_STATES as s (s)}<span><i class="mgl" data-s={s} aria-hidden="true"></i>{LABEL[s]}</span>{/each}
            </span>
          </div>
        </section>

        <section class="pg-panel pg-mixed" aria-labelledby="pg-h-mixed">
          <h2 id="pg-h-mixed">Mixed up most</h2>
          <div class="pg-rows" use:fitRows={(n) => (mixedPer = n)}>
            {#each shownPairs as c (c.a + c.b)}
              {@const where = inPlay.get(c.a)?.map.map.displayName}
              <div class="pg-pair" data-pair="{c.a}|{c.b}">
                <span class="pg-names">{#if severalMaps && where}<span class="sub">{where} · </span>{/if}{nameOf(c.a)} <span class="sub" aria-label="and">↔</span> {nameOf(c.b)}</span>
                <span class="pg-count sub nums">{c.count} {c.count === 1 ? 'time' : 'times'}</span>
              </div>
            {/each}
            {#if pairs.length === 0}
              <p class="pg-none sub">Nothing mixed up twice yet. Pairs you confuse at least twice appear here, and the next session shows them side by side.</p>
            {/if}
          </div>
          <div class="pg-foot">
            {#if mixedWin.pageCount > 1}
              <button type="button" class="pg-step" aria-label="Previous page of pairs" disabled={mixedWin.page <= 0} onclick={() => (mixedPick = mixedWin.page - 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" /></svg>
              </button>
              <span class="nums">{mixedWin.page + 1} / {mixedWin.pageCount}</span>
              <button type="button" class="pg-step" aria-label="Next page of pairs" disabled={mixedWin.page >= mixedWin.pageCount - 1} onclick={() => (mixedPick = mixedWin.page + 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m5 2 5 5-5 5" /></svg>
              </button>
            {/if}
          </div>
        </section>
      </div>

      <div class="pg-col b">
        <section class="pg-panel pg-speed" aria-labelledby="pg-h-speed">
          <h2 id="pg-h-speed">Speed <span class="sub">median time to a right answer, per week</span></h2>
          {#if trend.latest}
            <div class="pg-now">
              <p class="pg-big nums" data-testid="speed-now">{secondsText(trend.latest.medianMs as number)}</p>
              <p class="pg-delta sub">{speedChange ?? `Week of ${dayLabel(trend.latest.start)}`}</p>
            </div>
          {:else}
            <p class="pg-none sub">Nothing to show yet. Your speed appears once you have right answers.</p>
          {/if}
          <div class="pg-chart" use:sizeOf={(b) => (chartBox = b)}>
            {#if chartBox.w > 0 && chartBox.h > 0}
              <svg width={chartBox.w} height={chartBox.h} viewBox="0 0 {chartBox.w} {chartBox.h}" role="img" aria-label={chartLabel}>
                <line class="base" x1="0" x2={chartBox.w} y1={chartBox.h - 6} y2={chartBox.h - 6} />
                {#each chart.paths as d (d)}<path class="ln" {d} />{/each}
                {#each chart.dots as dot (dot.index)}
                  <circle class="dot" class:last={dot.last} cx={dot.x} cy={dot.y} r={dot.last ? 4 : 2.5}><title>Week of {dayLabel(weeks[dot.index]!.start)}: {secondsText(weeks[dot.index]!.medianMs as number)}</title></circle>
                {/each}
              </svg>
            {/if}
          </div>
          <div class="pg-axis cap"><span>{dayLabel(weeks[0]!.start)}</span><span>this week</span></div>
        </section>

        <section class="pg-panel pg-heat" aria-labelledby="pg-h-heat">
          <h2 id="pg-h-heat">
            Reviews <span class="sub">answers per day, last {WEEKS_SHOWN} weeks</span>
            <span class="pg-key" aria-hidden="true"><span>Less</span>{#each [0, 1, 2, 3, 4] as l (l)}<i class="pg-cell" data-level={l}></i>{/each}<span>More</span></span>
          </h2>
          <div class="pg-heatbox" use:sizeOf={(b) => (heatBox = b)}>
            {#if heatBox.w > 0 && heatBox.h > 0}
              <div
                class="pg-grid"
                role="img"
                aria-label={heatLabel}
                data-total={grid.total}
                style:grid-template-columns="{layout.gutter}px repeat({WEEKS_SHOWN}, {layout.cell}px)"
                style:grid-template-rows="14px repeat(7, {layout.cell}px)"
              >
                {#each grid.months as m (m.week)}<span class="pg-month" style:grid-column="{Math.min(m.week, WEEKS_SHOWN - 3) + 2} / span 3" style:grid-row="1">{m.label}</span>{/each}
                {#if layout.gutter > 0}{#each WEEKDAYS as d (d.row)}<span class="pg-wd" style:grid-row={d.row + 2}>{d.text}</span>{/each}{/if}
                {#each grid.cells as c (c.date)}
                  <i
                    class="pg-cell"
                    data-level={c.level}
                    data-date={c.date}
                    data-answers={c.answers}
                    style:grid-column={c.week + 2}
                    style:grid-row={c.weekday + 2}
                    title="{dayLabel(c.day)}: {c.answers} {c.answers === 1 ? 'answer' : 'answers'}"
                  ></i>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      </div>
    </main>
  {/if}
</div>
