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
  import { getSettings, hardModeFor } from '../app/settings';
  import RegionMap from '../components/RegionMap.svelte';
  import { replay } from '../core/log';
  import { fitView, shapesFor } from '../core/mapview';
  import { displayName } from '../core/naming';
  import { createScheduler } from '../core/scheduler';
  import { playableCallouts } from '../core/session';
  import { fillsAt, masteryFills, percent, type Fills } from '../core/stats';
  import { MASTERY_STATES, type Mastery } from '../core/types';
  import { openReviewStore } from '../storage/idb-store';

  let { map }: { map: string } = $props();

  const LABEL: Record<Mastery, string> = { new: 'New', seen: 'Seen', learning: 'Learning', familiar: 'Familiar', known: 'Known', automatic: 'Automatic' };
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** The lists are short on purpose: the screen has one viewport and the rest is on the Progress screen. */
  const MAX_MIXED = 3;
  const MAX_MOVED = 3;

  // Read once: the hand-off lives for the page's life and a new session replaces this screen.
  const last = getLastSession(map);
  const settings = getSettings();

  let boot = $state<'loading' | 'ready' | 'unknown' | 'error'>('loading');
  let data = $state.raw<MapData | null>(null);
  let current = $state.raw<Fills>({});

  async function readFills(found: MapData): Promise<Fills> {
    try {
      const store = await openReviewStore(found.demo ? 'callouts-demo' : 'callouts');
      const [{ events }, scheduler] = await Promise.all([store.load(), createScheduler()]);
      return masteryFills(found.callouts, replay(events, scheduler), scheduler);
    } catch (e) {
      console.warn('The review log could not be read; the summary map shows only what the session changed', e);
      return {};
    }
  }

  $effect(() => {
    let alive = true;
    (async () => {
      try {
        const maps = await loadAvailableMaps();
        const found = maps.find((m) => m.map.id === map);
        if (!alive) return;
        if (!found) {
          boot = 'unknown';
          return;
        }
        // with no session there is no map to draw, so the log is not even read
        const read = last ? await readFills(found) : {};
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
  const mixed = $derived((summary?.confusions ?? []).slice(0, MAX_MIXED));
  const moved = $derived(changes.slice(0, MAX_MOVED));
  const emptyText = $derived(
    !last || last.playable === 0
      ? 'This map has no callouts to learn yet.'
      : last.note === 'daily-cap'
        ? "You have reached today's limit of answers. Come back tomorrow."
        : 'Nothing was due, and there was nothing new to introduce. Come back later.',
  );

  const go = (hash: string) => (location.hash = hash);
  const mapLabel = (when: string) => `${data?.map.displayName ?? ''} mastery ${when}`;
</script>

<div class="app sm">
  <header class="bar">
    <span class="brand">callouts</span>
    <span class="crumb">
      <a href="#/"><span class="sm-hide-s">Maps</span></a><span class="sm-hide-s"> / </span>{#if data}<a href="#/map/{data.map.id}">{data.map.displayName}</a> / {/if}<b>Summary</b>
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
          <span><b>{accuracy ?? 0}%</b> correct</span>
          <span><b>{summary.correct} of {summary.answered}</b> right</span>
          <span><b>{seconds(average)}</b> average</span>
          {#if summary.introduced.length > 0}<span><b>{summary.introduced.length}</b> new</span>{/if}
        </div>
      </div>

      <div class="sm-acts">
        <button class="btn primary" type="button" onclick={() => go(`#/session/${data!.map.id}`)}>Another round</button>
        <button class="btn" type="button" onclick={() => go('#/')}>Done</button>
      </div>

      <div class="sm-lists">
        {#if summary.slowest.length > 0}
          <section aria-label="Slowest">
            <h2>Slowest</h2>
            <ul class="sm-list">
              {#each summary.slowest as s (s.calloutId + s.mode)}
                <li><span>{name(s.calloutId)}</span><span class="sub nums">{seconds(s.latencyMs)}</span></li>
              {/each}
            </ul>
          </section>
        {/if}
        <section aria-label="New confusions">
          <h2>Mixed up</h2>
          {#if mixed.length > 0}
            <ul class="sm-list">
              {#each mixed as c (c.target + c.chosen)}
                <li><span>{name(c.target)} for {name(c.chosen)}</span><span class="sub nums">{plural(c.count, 'time')}</span></li>
              {/each}
            </ul>
            {#if summary.confusions.length > MAX_MIXED}<p class="sub sm-more">and {summary.confusions.length - MAX_MIXED} more</p>{/if}
          {:else}
            <p class="sub">Nothing new this time.</p>
          {/if}
        </section>
        {#if moved.length > 0}
          <section aria-label="Moved up">
            <h2>Moved up</h2>
            <ul class="sm-list">
              {#each moved as m (m.calloutId)}
                <li><span>{name(m.calloutId)}</span><span class="sub">{LABEL[m.from]} → {LABEL[m.to]}</span></li>
              {/each}
            </ul>
            {#if changes.length > MAX_MOVED}<p class="sub sm-more">and {changes.length - MAX_MOVED} more</p>{/if}
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
