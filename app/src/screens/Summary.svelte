<script lang="ts" module>
  import { clearLastSession, setLastSession, type LastSession } from '../app/last-session';

  // A way for the browser tests to stand in for a finished session (e2e/): the Session screen fills the hand-off when it
  // ends, and until it does, or to get exact numbers, a test sets one. Development and e2e builds only, the same
  // condition as the demo map in app/data.ts, so production builds carry nothing of it.
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') {
    (window as unknown as { __calloutsStudy?: unknown }).__calloutsStudy = {
      setLastSession: (session: LastSession) => setLastSession(session),
      clearLastSession,
    };
  }
</script>

<script lang="ts">
  // The end of a session (SCOPE.md §4.3 step 5): cards done, accuracy, the slowest three, new confusions, and the map's
  // mastery overlay before and after. No confetti, one primary button. The numbers come from the hand-off the Session
  // screen leaves in app/last-session.ts; the map's current state is read from the review log (reading only).
  import '../styles/study.css';
  import '../styles/summary.css';
  import { getLastSession } from '../app/last-session';
  import { loadAvailableMaps, type MapData } from '../app/data';
  import { loadLearner } from '../app/progress';
  import { getSettings, hardModeFor } from '../app/settings';
  import RegionMap from '../components/RegionMap.svelte';
  import { fitView, shapesFor } from '../core/mapview';
  import { displayName } from '../core/naming';
  import { playableCallouts } from '../core/session';
  import { fillsAt, fitLists, masteryFills, percent, secondsText as seconds, type Fills } from '../core/stats';
  import { MASTERY_STATES, type Mastery } from '../core/types';

  let { map }: { map: string } = $props();

  const LABEL: Record<Mastery, string> = { new: 'New', seen: 'Seen', learning: 'Learning', familiar: 'Familiar', known: 'Known', automatic: 'Automatic' };
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** Most rows a list ever shows; the room on screen can lower it (`fitLists`). The rest is on the Progress screen. */
  const MAX_ROWS = 3;

  // The hand-off lives for the page's life and a new session replaces this screen, so it is not watched for changes.
  const last = $derived(getLastSession(map));
  const settings = getSettings();

  let boot = $state<'loading' | 'ready' | 'unknown' | 'error'>('loading');
  let data = $state.raw<MapData | null>(null);
  let current = $state.raw<Fills>({});

  async function readFills(found: MapData): Promise<Fills> {
    const learner = await loadLearner(found.demo);
    if (learner.failed) return {};
    return masteryFills(found.callouts, learner.derived, learner.scheduler);
  }

  $effect(() => {
    let alive = true;
    const wanted = map;
    const hasSession = last !== null;
    (async () => {
      try {
        const maps = await loadAvailableMaps();
        const found = maps.find((m) => m.map.id === wanted);
        if (!alive) return;
        if (!found) {
          boot = 'unknown';
          return;
        }
        // with no session there is no map to draw, so the log is not even read
        const read = hasSession ? await readFills(found) : {};
        if (!alive) return;
        data = found;
        current = read;
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

  const summary = $derived(last?.summary ?? null);
  const callouts = $derived(
    data ? playableCallouts(data.callouts, { hardMode: hardModeFor(settings, data.map.id), includeDraft: data.demo || new URLSearchParams(location.search).has('draft') }) : [],
  );
  const byId = $derived(new Map((data?.callouts ?? []).map((c) => [c.id, c])));
  const shapes = $derived(data ? shapesFor(callouts, data.map.projection) : []);
  const fit = $derived(fitView(shapes));
  const level = $derived(data?.map.levels[0]?.id ?? 'default');

  /** A name for the screen: through the naming setting when the callout is known here, else the one the session recorded. */
  function name(id: string): string {
    const c = byId.get(id);
    return c ? displayName(c, settings.naming) : (last?.names[id] ?? id);
  }

  const changes = $derived(summary?.mastery ?? []);
  const before = $derived(fillsAt(current, changes, 'from'));
  const after = $derived(fillsAt(current, changes, 'to'));
  const changed = $derived(new Set(changes.map((c) => c.calloutId)));

  const accuracy = $derived(summary ? percent(summary.correct, summary.answered) : null);
  const average = $derived(summary && summary.answered > 0 ? summary.totalMs / summary.answered : 0);
  const emptyText = $derived(
    !last || last.playable === 0
      ? 'This map has no callouts to learn yet.'
      : last.note === 'daily-cap'
        ? "You have reached today's limit of answers. Come back tomorrow."
        : 'Nothing was due, and there was nothing new to introduce. Come back later.',
  );

  // ---- the three lists share the room the left column has: every list gets a row before any gets a second ----
  let listsEl = $state<HTMLElement>();
  /** Pixels the lists may use. Unlimited where the page lays them out side by side and sizes itself to them (a phone upright). */
  let room = $state(Infinity);
  let pitch = $state({ row: 26, head: 58 });

  $effect(() => {
    const el = listsEl;
    if (!el) return;
    const measure = () => {
      const css = getComputedStyle(el);
      const sideBySide = css.gridTemplateColumns.split(' ').length > 1;
      room = sideBySide ? Infinity : el.clientHeight;
      // the stylesheet owns the sizes of a row and of a heading; it hands them over as custom properties
      pitch = { row: parseFloat(css.getPropertyValue('--sm-row')) || 26, head: parseFloat(css.getPropertyValue('--sm-head')) || 58 };
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  });

  const slowestAll = $derived(summary?.slowest ?? []);
  const mixedAll = $derived(summary?.confusions ?? []);
  const movedAll = $derived(changes);
  // "Mixed up" always has something to say, even if it is only that nothing new happened
  const rows = $derived(
    fitLists(room, [Math.min(MAX_ROWS, slowestAll.length), Math.min(MAX_ROWS, Math.max(1, mixedAll.length)), Math.min(MAX_ROWS, movedAll.length)], pitch.row, pitch.head),
  );
  const slowest = $derived(slowestAll.slice(0, rows[0]));
  const mixed = $derived(mixedAll.slice(0, rows[1]));
  const moved = $derived(movedAll.slice(0, rows[2]));

  const go = (hash: string) => (location.hash = hash);
  const mapLabel = (when: string) => `${data?.map.displayName ?? ''} mastery ${when}`;
</script>

<div class="app sm">
  <header class="bar">
    <span class="brand">callouts</span>
    <span class="crumb">
      <a href="#/"><span class="sm-hide-s">Maps</span></a><span class="sm-hide-s"> / </span>{#if data}<a href="#/map/{data.map.id}">{data.map.displayName}</a>{' / '}{/if}<b>Summary</b>
    </span>
  </header>

  {#if boot === 'loading'}
    <main class="sm-notice"><p class="sub">Loading</p></main>
  {:else if boot === 'unknown'}
    <main class="sm-notice">
      <h1>No such map</h1>
      <p>There is no map called {map}. <a href="#/">Back to the start</a></p>
    </main>
  {:else if boot === 'error' || !data}
    <main class="sm-notice">
      <h1>The map could not be loaded</h1>
      <p>Something is wrong with this map's data. <a href="#/">Back to the start</a></p>
    </main>
  {:else if !last || !summary}
    <main class="sm-notice">
      <h1>Nothing to summarise</h1>
      <p>A summary appears here when you finish or leave a session. Nothing has been played on {data.map.displayName} since this page was opened.</p>
      <div class="sm-acts">
        <button class="btn primary" type="button" onclick={() => go(`#/session/${data!.map.id}`)}>Start a session</button>
        <button class="btn" type="button" onclick={() => go('#/')}>Done</button>
      </div>
    </main>
  {:else if summary.answered === 0 && summary.introduced.length === 0}
    <main class="sm-notice">
      <span class="eyebrow">No session</span>
      <h1>Nothing to do</h1>
      <p>{emptyText}</p>
      <div class="sm-acts">
        <button class="btn primary" type="button" onclick={() => go('#/')}>Done</button>
      </div>
    </main>
  {:else}
    <main class="sm-body" class:solo={changes.length === 0}>
      <div class="sm-head">
        <span class="eyebrow">{summary.finished ? 'Session complete' : 'Session ended early, everything is saved'}</span>
        <h1>{plural(summary.answered, 'card')} done</h1>
        <div class="stats">
          {#if summary.answered > 0}
            <span><b>{accuracy ?? 0}%</b> correct</span>
            <span><b>{summary.correct} of {summary.answered}</b> right</span>
            <span><b>{seconds(average)}</b> average</span>
          {/if}
          {#if summary.introduced.length > 0}<span><b>{summary.introduced.length}</b> new</span>{/if}
        </div>
      </div>

      <div class="sm-acts">
        <button class="btn primary" type="button" onclick={() => go(`#/session/${data!.map.id}`)}>Another round</button>
        <button class="btn" type="button" onclick={() => go('#/')}>Done</button>
      </div>

      <div class="sm-lists" bind:this={listsEl}>
        {#if slowest.length > 0}
          <section aria-label="Slowest">
            <h2>Slowest{#if slowest.length < slowestAll.length}<span class="sub"> and {slowestAll.length - slowest.length} more</span>{/if}</h2>
            <ul class="sm-list">
              {#each slowest as s (s.calloutId + s.mode)}
                <li><span>{name(s.calloutId)}</span><span class="sub nums">{seconds(s.latencyMs)}</span></li>
              {/each}
            </ul>
          </section>
        {/if}
        {#if (rows[1] ?? 0) > 0}
          <section aria-label="New confusions">
            <h2>Mixed up{#if mixed.length < mixedAll.length}<span class="sub"> and {mixedAll.length - mixed.length} more</span>{/if}</h2>
            {#if mixedAll.length > 0}
              <ul class="sm-list">
                {#each mixed as c (c.target + c.chosen)}
                  <li><span>{name(c.target)} for {name(c.chosen)}</span><span class="sub nums">{plural(c.count, 'time')}</span></li>
                {/each}
              </ul>
            {:else}
              <ul class="sm-list"><li class="sub">Nothing new this time.</li></ul>
            {/if}
          </section>
        {/if}
        {#if moved.length > 0}
          <section aria-label="Moved up">
            <h2>Moved up{#if moved.length < movedAll.length}<span class="sub"> and {movedAll.length - moved.length} more</span>{/if}</h2>
            <ul class="sm-list">
              {#each moved as m (m.calloutId)}
                <li><span>{name(m.calloutId)}</span><span class="sub">{LABEL[m.from]} → {LABEL[m.to]}</span></li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>

      <div class="sm-maps">
        {#if shapes.length === 0}
          <p class="sub sm-nomap">This map has no callouts to draw.</p>
        {:else}
          <div class="sm-pair">
            {#if changes.length > 0}
              <figure class="sm-fig">
                <div class="plate sm-plate"><RegionMap {shapes} {fit} {level} label={mapLabel('before this session')} fills={before} art={data.art} /></div>
                <figcaption class="cap">Before</figcaption>
              </figure>
            {/if}
            <figure class="sm-fig">
              <div class="plate sm-plate"><RegionMap {shapes} {fit} {level} label={mapLabel('after this session')} fills={after} {changed} art={data.art} /></div>
              <figcaption class="cap">{changes.length > 0 ? 'After' : 'Your map now. Nothing moved up this session.'}</figcaption>
            </figure>
          </div>
          <div class="sm-legend" aria-label="Mastery states">
            {#each MASTERY_STATES as s (s)}<span><span class="mgl" data-s={s} aria-hidden="true"></span>{LABEL[s]}</span>{/each}
          </div>
        {/if}
      </div>
    </main>
  {/if}
</div>
