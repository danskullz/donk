<script lang="ts">
  import { onMount } from 'svelte';
  import indexJson from '../../../data/index.json';
  import { loadAvailableMaps, type MapData } from '../app/data';
  import { includeDraftFor, loadLearner, mapProgress, type Learner } from '../app/progress';
  import { getSettings, hardModeFor, subscribeSettings, updateSettings } from '../app/settings';
  import RegionMap from '../components/RegionMap.svelte';
  import { fitWithArt, listRows, MASTERY_LABEL, pageOf, pageRows, pathBounds } from '../core/mapui';
  import { fitView, shapesFor } from '../core/mapview';
  import { displayName, otherName } from '../core/naming';
  import { MapIndexSchema, type Callout } from '../core/schema';
  import { playableCallouts } from '../core/session';
  import { MASTERY_STATES } from '../core/types';
  import '../styles/map.css';

  let { map }: { map: string } = $props();

  const INDEX = MapIndexSchema.parse(indexJson);

  let root = $state<HTMLDivElement>();
  let status = $state<'loading' | 'ready' | 'unknown' | 'coming' | 'error'>('loading');
  let data = $state.raw<MapData | null>(null);
  let learner = $state.raw<Learner | null>(null);
  let settings = $state(getSettings());
  let now = $state(Date.now());

  onMount(() => {
    const stop = subscribeSettings((s) => (settings = s));
    let alive = true;
    (async () => {
      try {
        const known = INDEX.find((e) => e.id === map);
        const maps = await loadAvailableMaps();
        const found = maps.find((m) => m.map.id === map);
        if (!alive) return;
        if (!found) {
          status = known && !known.available ? 'coming' : known ? 'error' : 'unknown';
          return;
        }
        const learned = await loadLearner(found.demo);
        if (!alive) return;
        data = found;
        learner = learned;
        now = Date.now();
        status = 'ready';
        // the page itself holds focus, so the shortcut keys work at once (the session screen does the same)
        queueMicrotask(() => root?.focus({ preventScroll: true }));
      } catch (e) {
        console.error(e);
        if (alive) status = 'error';
      }
    })();
    return () => {
      alive = false;
      stop();
    };
  });

  // ---- what the map shows ----
  const hardMode = $derived(hardModeFor(settings, map));
  const inPlay = $derived(data ? playableCallouts(data.callouts, { hardMode, includeDraft: includeDraftFor(data) }) : []);
  const byId = $derived(new Map<string, Callout>(inPlay.map((c) => [c.id, c])));
  const naming = $derived(settings.naming);
  const nameOf = (c: Callout) => displayName(c, naming);

  const progress = $derived(
    data && learner ? mapProgress({ callouts: data.callouts, derived: learner.derived, scheduler: learner.scheduler, now, hardMode, includeDraft: includeDraftFor(data) }) : null,
  );
  /** How many Hard spots the switch would add: the ones that can be played once it is on. */
  const hardSpots = $derived(data ? playableCallouts(data.callouts, { hardMode: true, includeDraft: includeDraftFor(data) }).length - playableCallouts(data.callouts, { hardMode: false, includeDraft: includeDraftFor(data) }).length : 0);

  const levels = $derived(data?.map.levels.map((l) => l.id) ?? []);
  let chosenLevel = $state<string | null>(null);
  const level = $derived(chosenLevel ?? levels[0] ?? 'default');
  const art = $derived(data ? (data.artLevels?.[level] ?? (level === levels[0] ? data.art : null)) : null);

  const shapes = $derived(data ? shapesFor(inPlay, data.map.projection).map((s) => ({ ...s, name: nameOf(byId.get(s.id) as Callout) })) : []);
  const fit = $derived(
    data
      ? fitWithArt(fitView(shapes, { x: 0, y: 0, w: data.map.radarSize, h: data.map.radarSize }), art ? pathBounds(art) : null)
      : { x: 0, y: 0, w: 1024, h: 1024 },
  );

  // ---- zones, the list, the selection ----
  const zones = $derived((data?.map.zones ?? []).filter((z) => inPlay.some((c) => c.zone === z.id)));
  let chosenZone = $state<string | null>(null);
  const zone = $derived(zones.some((z) => z.id === chosenZone) ? (chosenZone as string) : (zones[0]?.id ?? ''));
  let chosenId = $state<string | null>(null);
  const rows = $derived(listRows(inPlay, zone));
  // The selection is the one the learner chose if it still exists (Hard mode may have taken it away), else the zone's first.
  const selectedId = $derived(chosenId !== null && byId.has(chosenId) ? chosenId : (rows[0]?.id ?? null));
  const selected = $derived(selectedId ? (byId.get(selectedId) ?? null) : null);
  const inZone = $derived(new Set(inPlay.filter((c) => c.zone === zone).map((c) => c.id)));

  function choose(id: string) {
    const c = byId.get(id);
    if (!c) return;
    chosenId = id;
    chosenZone = c.zone;
    chosenLevel = c.level;
  }
  function openZone(id: string) {
    chosenZone = id;
    chosenId = listRows(inPlay, id)[0]?.id ?? null;
  }

  // ---- the paged list: as many rows as the room holds ----
  let listEl = $state<HTMLUListElement>();
  let listH = $state(0);
  const pageSize = $derived.by(() => {
    if (!listEl || listH <= 0) return 0;
    const rowH = parseFloat(getComputedStyle(listEl).getPropertyValue('--mp-row-h')) || 44;
    return Math.max(1, Math.floor(listH / rowH));
  });
  const pages = $derived(pageSize > 0 ? pageRows(rows, pageSize) : []);
  let page = $state(0);
  const here = $derived(Math.min(page, Math.max(0, pages.length - 1)));
  const visible = $derived(pages[here] ?? []);

  // Choosing a callout, changing zone or resizing brings the page that holds the selection into view. Turning the
  // page by hand is not a reason to snap back, so `page` itself is not read here.
  $effect(() => {
    page = pageOf(pages, selectedId);
  });
  const turn = (by: number) => (page = Math.min(Math.max(0, here + by), Math.max(0, pages.length - 1)));

  // ---- Hard mode, per map ----
  function toggleHard() {
    updateSettings({ hardMode: { ...getSettings().hardMode, [map]: !hardMode } });
  }

  // ---- the selected callout's peek ----
  const peekShot = $derived(selected ? (selected.shots.find((s) => s.kind === 'approach') ?? selected.shots[0] ?? null) : null);
  let failedShot = $state<string | null>(null);
  const hardUnder = $derived(selected ? inPlay.filter((c) => c.parent === selected.id).length : 0);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  const dueIn = (id: string) => progress?.dueByCallout[id] ?? 0;
  const nothing = $derived(status === 'ready' && inPlay.length === 0);

  // ---- keyboard ----
  function tabKey(e: KeyboardEvent) {
    const at = zones.findIndex((z) => z.id === zone);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: zones.length - 1 }[e.key];
    if (to === undefined || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const next = zones[(to + zones.length) % zones.length];
    if (!next) return;
    openZone(next.id);
    queueMicrotask(() => document.getElementById(`tab-${next.id}`)?.focus());
  }
  function rowKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rowsEl = [...(listEl?.querySelectorAll<HTMLElement>('.mp-row') ?? [])];
    const at = rowsEl.findIndex((r) => r === document.activeElement);
    const next = rowsEl[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (at < 0 || !next) return;
    e.preventDefault();
    next.focus();
  }
  function keydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.key === ',') turn(-1);
    else if (e.key === '.') turn(1);
    else if ((e.key === 'h' || e.key === 'H') && inPlay.length + hardSpots > 0) toggleHard();
    else if ((e.key === 's' || e.key === 'S') && !nothing && status === 'ready') location.hash = `#/study/${map}`;
    else if (e.key === 'Escape') location.hash = '#/';
    // Enter belongs to whatever has focus (a row, a region, a button); on the page itself it starts the quiz.
    else if (e.key === 'Enter' && (t === document.body || t === root) && !nothing && status === 'ready') location.hash = `#/session/${map}`;
  }

  const title = $derived(data?.map.displayName ?? INDEX.find((e) => e.id === map)?.displayName ?? map);
</script>

<svelte:window onkeydown={keydown} />

<div class="app mp" tabindex="-1" bind:this={root}>
  <header class="bar">
    <a class="brand" href="#/">callouts</a>
    <span class="crumb"><a href="#/">Maps</a><span class="hide-s">{' / '}</span><b class="hide-s">{title}</b></span>
    <span class="grow"></span>
    {#if status === 'ready' && inPlay.length + hardSpots > 0}
      <button class="mp-switch" type="button" role="switch" aria-checked={hardMode} onclick={toggleHard}>
        <i></i><span class="hide-s">Hard mode</span>
      </button>
      <span class="chip hide-s">{hardMode ? `on · ${plural(hardSpots, 'spot')}` : hardSpots > 0 ? `off · ${hardSpots} hidden` : 'off · no hard spots yet'}</span>
    {/if}
    {#if progress && progress.due > 0}<span class="chip due">{progress.due} due</span>{/if}
  </header>

  {#if status === 'loading'}
    <main class="mp-note loading"><h1 class="sr-only">{title}</h1><p class="sub">Loading the map.</p></main>
  {:else if status !== 'ready'}
    <main class="mp-note">
      <h1 class="sr-only">{title}</h1>
      {#if status === 'unknown'}
        <p class="sub">There is no map called {map}. <a href="#/">Back to the maps</a></p>
      {:else if status === 'coming'}
        <p class="sub">{title} is not built yet. <a href="#/">Back to the maps</a></p>
      {:else}
        <p class="sub">This map could not be loaded. <a href="#/">Back to the maps</a></p>
      {/if}
    </main>
  {:else if data && progress}
    <main class="mp-body">
      <div class="plate mp-plate">
        <div class="mp-stage">
          <RegionMap
            {shapes}
            {fit}
            {level}
            {art}
            {levels}
            onlevel={(id) => (chosenLevel = id)}
            label="{title} with mastery by callout"
            interactive
            labels
            fills={progress.fills}
            selected={selectedId}
            focus={inZone}
            follow
            onregion={choose}
          />
        </div>
        <div class="mp-legend" aria-label="Legend">
          {#each MASTERY_STATES as m (m)}<span><i class="mp-g {m}" aria-hidden="true"></i>{MASTERY_LABEL[m]}</span>{/each}
          {#if hardMode && hardSpots > 0}<span><i class="mp-g hard" aria-hidden="true"></i>Hard spot</span>{/if}
        </div>
      </div>

      <div class="mp-side">
        <div class="mp-title">
          <h1>{title}</h1>
          {#if nothing}
            <div class="mp-stats"><span>No callouts yet</span></div>
          {:else}
            <div class="mp-stats">
              <span><b>Core {progress.core.familiar} of {progress.core.total}</b></span>
              <span><b>{progress.percent}%</b> mastery</span>
              {#if progress.due > 0}<span class="chip due">{progress.due} due</span>{/if}
            </div>
          {/if}
        </div>

        {#if nothing}
          <div class="mp-empty">
            <b>Nothing to learn here yet.</b>
            <span>The callouts for {title} are added with the editor and checked in the game, so there is nothing to study or quiz.</span>
            <a class="btn" href="#/">Back to the maps</a>
          </div>
          <span></span>
        {:else}
          <div class="tabs" role="tablist" aria-label="Zones" tabindex="-1" onkeydown={tabKey}>
            {#each zones as z (z.id)}
              <button class="tab" type="button" role="tab" id="tab-{z.id}" aria-selected={z.id === zone} aria-controls="mp-panel" tabindex={z.id === zone ? 0 : -1} onclick={() => openZone(z.id)}>{z.name}</button>
            {/each}
          </div>

          <div class="mp-listwrap" id="mp-panel" role="tabpanel" aria-labelledby="tab-{zone}">
            <ul class="mp-list" aria-label="{zoneName(zone)} callouts" bind:this={listEl} bind:clientHeight={listH}>
              {#each visible as r (r.id)}
                {@const c = byId.get(r.id)}
                {#if c}
                  {@const m = progress.fills[c.id] ?? 'new'}
                  <li>
                    <button class="mp-row" class:nested={r.nested} type="button" data-id={c.id} data-mastery={m} aria-current={c.id === selectedId ? 'true' : null} onclick={() => choose(c.id)} onkeydown={rowKey}>
                      <i class="mp-g {m}" aria-hidden="true"></i>
                      <span class="nm">{nameOf(c)}</span>
                      <span class="st">{MASTERY_LABEL[m]}{r.nested ? ' · hard' : ''}{dueIn(c.id) > 0 ? ' · due' : ''}</span>
                      <span class="due" class:none={dueIn(c.id) === 0} aria-hidden="true"></span>
                    </button>
                  </li>
                {/if}
              {/each}
            </ul>
            {#if pages.length > 1}
              <div class="mp-pager">
                <span class="pg">
                  <button type="button" aria-label="Previous page" disabled={here === 0} onclick={() => turn(-1)}>‹</button>
                  <span class="nums" aria-live="polite">{here + 1} / {pages.length}</span>
                  <button type="button" aria-label="Next page" disabled={here >= pages.length - 1} onclick={() => turn(1)}>›</button>
                </span>
                <span class="hide-s"><kbd>,</kbd> prev <kbd>.</kbd> next</span>
              </div>
            {/if}
            {#if selected}
              <div class="mp-peek">
                <div class="plate">
                  {#if peekShot && failedShot !== peekShot.file}
                    <img src={data.shotUrl(peekShot.file)} alt={selected.blurb} onerror={() => (failedShot = peekShot.file)} />
                  {:else}
                    <div class="none">{selected.shots.length === 0 ? 'no screenshot yet' : 'screenshot not found'}</div>
                  {/if}
                </div>
                <div>
                  <span class="eyebrow">Selected{selected.tier === 3 ? ' · hard spot' : ''}</span>
                  <h3>{nameOf(selected)}</h3>
                  <p>{selected.blurb}</p>
                  <div class="chips">
                    <span class="chip">{plural(selected.shots.length, 'shot')}{hardUnder > 0 ? ` · ${plural(hardUnder, 'hard spot')}` : ''}</span>
                    {#if otherName(selected, naming)}<span class="chip">game name: {otherName(selected, naming)}</span>{/if}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <div class="mp-acts">
          {#if nothing}
            <button class="btn primary" type="button" disabled>Quiz this map</button>
            <button class="btn" type="button" disabled>Study</button>
            <button class="btn" type="button" disabled>Quiz this zone</button>
          {:else}
            <a class="btn primary" href="#/session/{map}">Quiz this map <kbd class="hide-s">Enter</kbd></a>
            <a class="btn" href="#/study/{map}">Study <kbd class="hide-s">S</kbd></a>
            <a class="btn" href="#/session/{map}?zone={zone}">Quiz this zone</a>
          {/if}
        </div>
      </div>
    </main>
  {/if}
</div>
