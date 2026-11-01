<script lang="ts">
  // Study: look first, quiz later (SCOPE.md §4.8, §5.1). The map, a zone-paged list and one large screenshot with a
  // thumbnail strip are linked: pick a region, a row or a neighbour and all three follow. Reading only: this screen
  // never writes to the review log (it reads it to tint the map and filter by state). Answering is what schedules.
  import { tick } from 'svelte';
  import '../styles/study.css';
  import { loadAvailableMaps, type MapData } from '../app/data';
  import { getSettings, hardModeFor, subscribeSettings } from '../app/settings';
  import RegionMap from '../components/RegionMap.svelte';
  import { replay } from '../core/log';
  import { coneFor, fitView, shapesFor } from '../core/mapview';
  import { displayName, otherName } from '../core/naming';
  import { createScheduler } from '../core/scheduler';
  import type { Callout } from '../core/schema';
  import { playableCallouts } from '../core/session';
  import { headingOf, masteryFills, type Fills } from '../core/stats';
  import { MASTERY_STATES, type Mastery } from '../core/types';
  import { openReviewStore } from '../storage/idb-store';

  let { map }: { map: string } = $props();

  const STATE_LABEL: Record<Mastery, string> = { new: 'New', seen: 'Seen', learning: 'Learning', familiar: 'Familiar', known: 'Known', automatic: 'Automatic' };
  const TIER_LABEL = { 1: 'Core', 2: 'Standard', 3: 'Hard' } as const;

  let boot = $state<'loading' | 'ready' | 'unknown' | 'error'>('loading');
  let data = $state.raw<MapData | null>(null);
  let fills = $state.raw<Fills>({});
  /** False when the review log could not be read: the map then shows no progress and says so. */
  let progressOk = $state(true);
  let settings = $state.raw(getSettings());

  let zoneId = $state('');
  let selectedId = $state<string | null>(null);
  let shotIdx = $state(0);
  let tierFilter = $state<'all' | '1' | '2' | '3'>('all');
  let stateFilter = $state<'all' | Mastery>('all');
  /** The floor shown when the learner picks one; otherwise the selected callout's floor. */
  let levelPick = $state<string | null>(null);
  /** On a phone the three panes take turns in one slot. */
  let view = $state<'photo' | 'map' | 'list'>('photo');
  let manualPage = $state<number | null>(null);
  const broken = $state<Record<string, true>>({});

  let rowsEl = $state<HTMLElement>();
  let rowsHeight = $state(0);
  let rowHeight = $state(36);

  $effect(() => subscribeSettings((s) => (settings = s)));

  async function readFills(found: MapData): Promise<Fills | null> {
    try {
      const store = await openReviewStore(found.demo ? 'callouts-demo' : 'callouts');
      const [{ events }, scheduler] = await Promise.all([store.load(), createScheduler()]);
      return masteryFills(found.callouts, replay(events, scheduler), scheduler);
    } catch (e) {
      console.warn('The review log could not be read; the study screen shows no progress', e);
      return null;
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
        const read = await readFills(found);
        if (!alive) return;
        data = found;
        fills = read ?? {};
        progressOk = read !== null;
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

  const naming = $derived(settings.naming);
  // The same callouts a session would teach: Hard spots only with Hard mode, drafts only for the demo map or `?draft`.
  const callouts = $derived(
    data ? playableCallouts(data.callouts, { hardMode: hardModeFor(settings, data.map.id), includeDraft: data.demo || new URLSearchParams(location.search).has('draft') }) : [],
  );
  const byId = $derived(new Map(callouts.map((c) => [c.id, c])));
  const shapes = $derived(data ? shapesFor(callouts, data.map.projection) : []);
  const fit = $derived(fitView(shapes));
  const zones = $derived(data ? data.map.zones.filter((z) => callouts.some((c) => c.zone === z.id)) : []);
  const zoneIdx = $derived(zones.findIndex((z) => z.id === zoneId));
  const zone = $derived(zones[zoneIdx] ?? null);
  const hasHard = $derived(callouts.some((c) => c.tier === 3));

  const routeOrder = (a: Callout, b: Callout) => (a.order ?? 9999) - (b.order ?? 9999) || (a.id < b.id ? -1 : 1);
  const stateOf = (c: Callout): Mastery => fills[c.id] ?? 'new';
  const matches = (c: Callout) => (tierFilter === 'all' || String(c.tier) === tierFilter) && (stateFilter === 'all' || stateOf(c) === stateFilter);
  const filtered = $derived(tierFilter !== 'all' || stateFilter !== 'all');

  const inZone = $derived(callouts.filter((c) => c.zone === zoneId).sort(routeOrder));
  /** The zone's callouts after the filters, in route order: this is the list and the tour. */
  const listed = $derived(inZone.filter(matches));
  const tourIdx = $derived(listed.findIndex((c) => c.id === selectedId));

  const perPage = $derived(Math.max(0, Math.floor(rowsHeight / rowHeight)));
  const pageCount = $derived(perPage > 0 ? Math.max(1, Math.ceil(listed.length / perPage)) : 1);
  const page = $derived(Math.min(pageCount - 1, Math.max(0, manualPage ?? (perPage > 0 && tourIdx >= 0 ? Math.floor(tourIdx / perPage) : 0))));
  const visible = $derived(perPage > 0 ? listed.slice(page * perPage, page * perPage + perPage) : []);

  const sel = $derived(selectedId ? (byId.get(selectedId) ?? null) : null);
  const shots = $derived(sel?.shots ?? []);
  const shot = $derived(shots[Math.min(shotIdx, shots.length - 1)] ?? null);
  const cone = $derived(shot && data ? coneFor(data.map.projection, shot, fit) : null);
  const level = $derived(levelPick ?? sel?.level ?? data?.map.levels[0]?.id ?? 'default');
  const neighbours = $derived(sel ? sel.neighbours.flatMap((id) => byId.get(id) ?? []) : []);
  const gameName = $derived(sel ? otherName(sel, naming) : null);

  function setSelected(id: string | null) {
    selectedId = id;
    shotIdx = 0;
    levelPick = null;
  }

  // The selection must be in the list. A change of zone, filter or Hard mode can leave it outside; fall back to the first.
  $effect(() => {
    if (!data) return;
    if (!zones.some((z) => z.id === zoneId)) {
      zoneId = zones[0]?.id ?? '';
      return;
    }
    if (selectedId === null ? listed.length > 0 : !listed.some((c) => c.id === selectedId)) setSelected(listed[0]?.id ?? null);
  });

  // The row height is the stylesheet's; measure it so the page size always matches what fits (nothing scrolls).
  $effect(() => {
    void visible.length;
    const row = rowsEl?.querySelector<HTMLElement>('.st-row');
    if (row && row.offsetHeight > 0) rowHeight = row.offsetHeight;
  });

  // Load the next callout's picture before it is asked for, so stepping through a zone does not flash.
  $effect(() => {
    const next = listed[tourIdx + 1]?.shots[0];
    if (next && data) new Image().src = data.shotUrl(next.file);
  });

  function choose(id: string) {
    setSelected(id);
    manualPage = null;
    view = 'photo';
  }

  /** A pick from the map or a neighbour chip wins over the filters and the zone: it would otherwise select what the list hides. */
  function pick(id: string) {
    const c = byId.get(id);
    if (!c) return;
    if (!matches(c)) {
      tierFilter = 'all';
      stateFilter = 'all';
    }
    zoneId = c.zone;
    setSelected(id);
    manualPage = null;
  }

  function firstOf(zid: string): string | null {
    return callouts.filter((c) => c.zone === zid && matches(c)).sort(routeOrder)[0]?.id ?? null;
  }

  function goZone(by: number) {
    const z = zones[zoneIdx + by];
    if (!z) return;
    zoneId = z.id;
    setSelected(firstOf(z.id));
    manualPage = null;
  }

  async function step(by: number, refocus = false) {
    const next = listed[tourIdx + by];
    if (!next) return;
    setSelected(next.id);
    manualPage = null;
    if (refocus) {
      await tick();
      rowsEl?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
    }
  }

  function resetFilters() {
    tierFilter = 'all';
    stateFilter = 'all';
    manualPage = null;
  }

  function onkey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !data) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      void step(e.key === 'ArrowLeft' ? -1 : 1, t instanceof HTMLElement && t.closest('.st-rows') !== null);
    } else if (e.key === '[' || e.key === ']') {
      goZone(e.key === '[' ? -1 : 1);
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= shots.length) {
      shotIdx = Number(e.key) - 1;
    }
  }

  function onrows(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    void step(e.key === 'ArrowUp' ? -1 : 1, true);
  }

  const thumbUrl = (s: { file: string }) => data?.shotUrl(s.file) ?? '';
</script>

<svelte:window onkeydown={onkey} />

{#if boot === 'loading'}
  <div class="app st">
    <header class="bar"><span class="brand">callouts</span></header>
    <main class="st-notice"><p class="sub">Loading</p></main>
  </div>
{:else if boot === 'unknown'}
  <div class="app st">
    <header class="bar"><span class="brand">callouts</span></header>
    <main class="st-notice">
      <h1>No such map</h1>
      <p>There is no map called {map}. <a href="#/">Back to the start</a></p>
    </main>
  </div>
{:else if boot === 'error' || !data}
  <div class="app st">
    <header class="bar"><span class="brand">callouts</span></header>
    <main class="st-notice">
      <h1>The map could not be loaded</h1>
      <p>Something is wrong with this map's data. <a href="#/">Back to the start</a></p>
    </main>
  </div>
{:else}
  <div class="app st">
    <header class="bar">
      <span class="brand">callouts</span>
      <span class="crumb"><a href="#/"><span class="st-hide-s">Maps</span></a><span class="st-hide-s"> / </span><a href="#/map/{data.map.id}">{data.map.displayName}</a> / <b>Study</b></span>
      <span class="grow"></span>
      {#if !progressOk}<span class="chip warn" title="The review log could not be read, so no progress is shown.">no progress</span>{/if}
      <a class="btn primary" href="#/session/{data.map.id}">Quiz this map</a>
    </header>

    {#if callouts.length === 0}
      <main class="st-notice">
        <h1>Nothing to study yet</h1>
        <p>
          {#if data.callouts.length === 0}
            {data.map.displayName} has no callouts yet.
          {:else}
            {data.map.displayName} has callouts, but none are ready to show: they are still drafts, or Hard mode only.
          {/if}
          <a href="#/map/{data.map.id}">Back to the map</a>
        </p>
      </main>
    {:else}
      <main class="st-body" data-view={view}>
        <h1 class="sr-only">Study {data.map.displayName}</h1>

        <div class="st-views" role="group" aria-label="Show">
          <button type="button" class="st-vt" aria-pressed={view === 'photo'} onclick={() => (view = 'photo')}>Photo</button>
          <button type="button" class="st-vt" aria-pressed={view === 'map'} onclick={() => (view = 'map')}>Map</button>
          <button type="button" class="st-vt" aria-pressed={view === 'list'} onclick={() => (view = 'list')}>List</button>
        </div>

        <section class="st-nav" aria-label="Callouts in {zone?.name ?? 'this zone'}">
          <div class="st-zone">
            <button type="button" class="st-step" aria-label="Previous zone" disabled={zoneIdx <= 0} onclick={() => goZone(-1)}>
              <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" /></svg>
            </button>
            <span class="st-zname" aria-live="polite"><b>{zone?.name ?? ''}</b> <span class="sub nums">{zoneIdx + 1} / {zones.length}</span></span>
            <button type="button" class="st-step" aria-label="Next zone" disabled={zoneIdx >= zones.length - 1} onclick={() => goZone(1)}>
              <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m5 2 5 5-5 5" /></svg>
            </button>
          </div>

          <div class="st-filters">
            <select class="st-sel" aria-label="Tier" bind:value={tierFilter} onchange={() => (manualPage = null)}>
              <option value="all">All tiers</option>
              <option value="1">Core</option>
              <option value="2">Standard</option>
              {#if hasHard}<option value="3">Hard</option>{/if}
            </select>
            <select class="st-sel" aria-label="State" bind:value={stateFilter} onchange={() => (manualPage = null)}>
              <option value="all">All states</option>
              {#each MASTERY_STATES as s (s)}<option value={s}>{STATE_LABEL[s]}</option>{/each}
            </select>
          </div>

          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="st-rows" role="group" aria-label="Callouts" bind:this={rowsEl} bind:clientHeight={rowsHeight} onkeydown={onrows}>
            {#each visible as c (c.id)}
              {@const st = stateOf(c)}
              <button type="button" class="st-row" class:nested={c.tier === 3} aria-current={c.id === selectedId ? 'true' : undefined} data-id={c.id} onclick={() => choose(c.id)}>
                <span class="mgl" data-s={st} aria-hidden="true"></span>
                <span class="st-nm">{displayName(c, naming)}</span>
                <span class="st-st">{STATE_LABEL[st]}</span>
              </button>
            {/each}
          </div>

          <div class="st-pager">
            {#if listed.length === 0}
              <span class="sub">{filtered ? 'Nothing matches.' : 'Nothing here.'}</span>
              {#if filtered}<button type="button" class="st-link" onclick={resetFilters}>Show all</button>{/if}
            {:else if pageCount > 1}
              <button type="button" class="st-step sm" aria-label="Previous page" disabled={page <= 0} onclick={() => (manualPage = page - 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" /></svg>
              </button>
              <span class="nums">{page + 1} / {pageCount}</span>
              <button type="button" class="st-step sm" aria-label="Next page" disabled={page >= pageCount - 1} onclick={() => (manualPage = page + 1)}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m5 2 5 5-5 5" /></svg>
              </button>
              <span class="sub st-count">{listed.length} callouts</span>
            {:else}
              <span class="sub">{listed.length} {listed.length === 1 ? 'callout' : 'callouts'}{filtered ? ' match' : ''}</span>
            {/if}
          </div>
        </section>

        <section class="st-photo" aria-label="Screenshots{sel ? ` of ${displayName(sel, naming)}` : ''}">
          <div class="plate st-shot">
            {#if sel && shot && !broken[shot.file]}
              <img src={thumbUrl(shot)} alt={sel.blurb} onerror={() => (broken[shot.file] = true)} />
            {:else if sel}
              <p class="st-none sub">{shot ? 'This screenshot could not be loaded.' : 'No screenshot of this callout yet.'}</p>
            {:else}
              <p class="st-none sub">Nothing selected.</p>
            {/if}
          </div>
          <div class="st-thumbs" style:--n={Math.max(1, shots.length)}>
            {#each shots as s, i (s.file)}
              <button type="button" class="st-thumb" aria-label="Screenshot {i + 1} of {shots.length}, {s.kind} view" aria-current={i === shotIdx ? 'true' : undefined} onclick={() => (shotIdx = i)}>
                {#if !broken[s.file]}<img src={thumbUrl(s)} alt="" onerror={() => (broken[s.file] = true)} />{/if}
              </button>
            {/each}
          </div>
          <div class="cap st-cap">
            {#if shot}{shot.kind} view · {shotIdx + 1} of {shots.length} · facing {headingOf(shot.yaw)}{:else}&nbsp;{/if}
          </div>
          <div class="st-keys"><kbd>←</kbd><kbd>→</kbd> callout <kbd>1</kbd> to <kbd>{Math.max(1, Math.min(9, shots.length))}</kbd> screenshot <kbd>[</kbd><kbd>]</kbd> zone</div>
        </section>

        <div class="st-where">
          <div class="plate st-map">
            <RegionMap
              {shapes}
              {fit}
              {level}
              label="{data.map.displayName}{sel ? `, ${displayName(sel, naming)} selected` : ''}{cone ? ', with the camera position and facing' : ''}. The list is the keyboard route to every callout."
              interactive
              {cone}
              {fills}
              art={data.art}
              selected={selectedId}
              onregion={pick}
            />
            {#if data.map.levels.length > 1}
              <div class="st-levels" role="group" aria-label="Floor">
                {#each data.map.levels as l (l.id)}
                  <button type="button" class="st-vt sm" aria-pressed={l.id === level} onclick={() => (levelPick = l.id)}>{l.id}</button>
                {/each}
              </div>
            {/if}
          </div>

          <div class="st-about">
            {#if sel}
              <h2 class="st-name" style:--n={displayName(sel, naming).length}>{displayName(sel, naming)}</h2>
              <div class="st-tags">
                <span class="chip">{TIER_LABEL[sel.tier]}</span>
                <span class="chip st-state"><span class="mgl" data-s={stateOf(sel)} aria-hidden="true"></span>{STATE_LABEL[stateOf(sel)]}</span>
              </div>
              <p class="st-blurb">{sel.blurb}</p>
              {#if gameName}<p class="st-game sub">The game calls it <b>{gameName}</b></p>{/if}
              {#if neighbours.length > 0}
                <div class="st-nbs">
                  <span class="eyebrow">Next to</span>
                  {#each neighbours as n (n.id)}
                    <button type="button" class="chip st-nb" onclick={() => pick(n.id)}>{displayName(n, naming)}</button>
                  {/each}
                </div>
              {/if}
            {:else}
              <p class="sub">{filtered ? 'No callout matches these filters.' : 'Pick a callout.'}</p>
              {#if filtered}<button type="button" class="btn" onclick={resetFilters}>Show all</button>{/if}
            {/if}
            <div class="st-tour">
              <button type="button" class="btn" aria-label="Previous callout" disabled={tourIdx <= 0} onclick={() => step(-1)}>Previous</button>
              <span class="st-pos nums" aria-live="polite">{tourIdx >= 0 ? tourIdx + 1 : 0} / {listed.length}</span>
              <button type="button" class="btn" aria-label="Next callout" disabled={tourIdx < 0 || tourIdx >= listed.length - 1} onclick={() => step(1)}>Next</button>
            </div>
          </div>
        </div>
      </main>
    {/if}
  </div>
{/if}
