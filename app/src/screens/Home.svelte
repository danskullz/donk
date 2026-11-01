<script lang="ts" module>
  // The first-time redirect to the primer happens once per page load: a learner who comes back to Home from the
  // primer (or with the Back button) is not sent there again.
  let primerOffered = false;
</script>

<script lang="ts">
  import '../styles/home.css';
  import indexJson from '../../../data/index.json';
  import { loadAvailableMaps, type MapData } from '../app/data';
  import { loadProgress, pickMaps, type MapProgress, type ProgressSnapshot } from '../app/progress';
  import { getSettings } from '../app/settings';
  import RegionMap from '../components/RegionMap.svelte';
  import { bestGrid } from '../core/mapui';
  import { fitView, shapesFor, type MapShape, type ViewBox } from '../core/mapview';
  import { MapIndexSchema } from '../core/schema';

  const index = MapIndexSchema.parse(indexJson);

  let maps = $state.raw<MapData[]>([]);
  let progress = $state.raw<ProgressSnapshot | null>(null);
  let loadState = $state<'loading' | 'ready' | 'error'>('loading');
  let picker = $state<HTMLElement>();
  let box = $state<DOMRectReadOnly>();
  let gap = $state(12);

  $effect(() => {
    if (!getSettings().primerSeen && !primerOffered) {
      primerOffered = true;
      location.replace('#/primer');
    }
  });

  $effect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await loadAvailableMaps();
        if (!live) return;
        maps = loaded;
        const snapshot = await loadProgress(loaded);
        if (!live) return;
        progress = snapshot;
        loadState = 'ready';
      } catch (e) {
        console.error(e);
        if (live) loadState = 'error';
      }
    })();
    return () => {
      live = false;
    };
  });

  // ---- one card per map in the index, plus the development map when the build has it ----
  interface Card {
    id: string;
    name: string;
    demo: boolean;
    kind: 'soon' | 'loading' | 'empty' | 'ready';
    data: MapData | null;
    stats: MapProgress | null;
    shapes: readonly MapShape[];
    fit: ViewBox;
  }

  const cards = $derived.by<Card[]>(() => {
    const loaded = new Map(maps.map((m) => [m.map.id, m]));
    const out = index.map((e) => describe(e.id, e.displayName, false, e.available, loaded.get(e.id) ?? null));
    for (const m of maps) if (m.demo && !index.some((e) => e.id === m.map.id)) out.push(describe(m.map.id, m.map.displayName, true, true, m));
    return out;
  });

  function describe(id: string, name: string, demo: boolean, available: boolean, data: MapData | null): Card {
    const stats = progress?.byMap.get(id) ?? null;
    const base = { id, name, demo, data, stats };
    if (!available) return { ...base, kind: 'soon', shapes: [], fit: fitView([]) };
    if (!data || !stats) return { ...base, kind: 'loading', shapes: [], fit: fitView([]) };
    const inPlay = data.callouts.filter((c) => c.id in stats.fills);
    const shapes = shapesFor(inPlay, data.map.projection);
    return { ...base, kind: stats.playable ? 'ready' : 'empty', shapes, fit: fitView(shapes) };
  }

  // ---- what the buttons offer ----
  const picks = $derived(
    pickMaps(
      cards
        .filter((c) => c.stats)
        .map((c) => ({ mapId: c.id, demo: c.demo, playable: c.stats?.playable ?? false, due: c.stats?.due ?? 0, lastActivity: c.stats?.lastActivity ?? null })),
    ),
  );
  const nameOf = (id: string | null) => cards.find((c) => c.id === id)?.name ?? '';
  const totalDue = $derived(cards.reduce((n, c) => n + (c.stats?.due ?? 0), 0));
  const anyPlayable = $derived(cards.some((c) => c.stats?.playable));
  const target = $derived(cards.find((c) => c.id === picks.start)?.stats ?? null);
  const newToday = $derived(target ? Math.min(getSettings().newPerSession, target.states.new) : 0);
  const firstRun = $derived(picks.resume === null);
  const headline = $derived.by(() => {
    if (loadState === 'loading') return 'Loading…';
    if (loadState === 'error') return 'Could not load the maps';
    if (!anyPlayable) return 'No callouts yet';
    if (!target) return '';
    if (target.due === 0 && newToday === 0) return 'All caught up';
    return `${target.due} due · ${newToday} new`;
  });
  const subline = $derived.by(() => {
    if (loadState !== 'ready') return '';
    if (!anyPlayable) return 'Maps are built one at a time. Every map is listed below.';
    const withDue = cards.filter((c) => (c.stats?.due ?? 0) > 0).map((c) => c.name);
    return withDue.length > 0 ? withDue.join(', ') : nameOf(picks.start);
  });
  const marker = (c: Card): string | null => {
    if (c.id !== picks.start) return null;
    if (firstRun) return 'start here';
    return (c.stats?.due ?? 0) > 0 ? 'most due' : 'next up';
  };

  // ---- the grid: as many columns and rows as give the cards the most room, never more than the window holds ----
  $effect(() => {
    void box;
    if (picker) gap = parseFloat(getComputedStyle(picker).columnGap) || 12;
  });
  const grid = $derived.by(() => {
    const n = Math.max(1, cards.length);
    const w = box?.width ?? 0;
    const h = box?.height ?? 0;
    if (w < 10 || h < 10) return { cols: 5, rows: Math.ceil(n / 5), variant: 'stack' as const };
    const roomy = bestGrid(n, w, h, gap, 150, h < 330 ? 130 : 168, 1.1);
    if (roomy) return { cols: roomy.cols, rows: roomy.rows, variant: 'stack' as const };
    const slim = bestGrid(n, w, h, gap, 150, 56, 2.6);
    if (slim) return { cols: slim.cols, rows: slim.rows, variant: 'row' as const };
    return { cols: 2, rows: Math.ceil(n / 2), variant: 'row' as const };
  });

  // ---- keys: arrows move between the maps you can open, Enter starts a session ----
  function arrows(e: KeyboardEvent) {
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: grid.cols, ArrowUp: -grid.cols } as Record<string, number | undefined>)[e.key];
    if (step === undefined || e.ctrlKey || e.metaKey || e.altKey || !picker) return;
    const all = [...picker.querySelectorAll<HTMLElement>('.card')];
    const from = all.indexOf(document.activeElement as HTMLElement);
    const dir = Math.sign(step);
    let i = from < 0 ? (dir > 0 ? -1 : all.length) + dir : from + step;
    // skip the maps that are not there yet
    while (i >= 0 && i < all.length && all[i]?.tagName !== 'A') i += dir;
    const next = all[i];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }
  function enter(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.target !== document.body || !picks.start) return;
    location.hash = `#/session/${picks.start}`;
  }
</script>

<svelte:window onkeydown={enter} />

<div class="app home">
  <h1 class="sr-only">Callouts: pick a map</h1>
  <header class="bar">
    <span class="brand">callouts</span>
    <span class="crumb hide-s">Maps</span>
    <span class="grow"></span>
    {#if progress?.failed}<span class="chip warn">progress could not be read</span>{/if}
    {#if totalDue > 0}<span class="chip due">{totalDue} due</span>{/if}
    <a class="link" href="#/progress">Progress</a>
    <a class="link" href="#/settings">Settings</a>
  </header>

  <section class="today" aria-label="Next session">
    <div class="lead">
      <span class="eyebrow">Next session</span>
      <span class="big">{headline}</span>
      <span class="sub hide-s">{subline}</span>
    </div>
    <div class="acts">
      {#if picks.resume}
        <a class="btn" href="#/map/{picks.resume}">Continue<span class="hide-s dim">&nbsp;· {nameOf(picks.resume)}</span></a>
      {/if}
      {#if picks.start}
        <a class="btn primary" href="#/session/{picks.start}">Start session <kbd class="hide-s">enter</kbd></a>
      {:else}
        <button class="btn primary" type="button" disabled>Start session</button>
      {/if}
    </div>
  </section>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <main
    class="picker"
    aria-label="Maps"
    bind:this={picker}
    bind:contentRect={box}
    onkeydown={arrows}
    style:grid-template-columns="repeat({grid.cols}, minmax(0, 1fr))"
    style:grid-template-rows="repeat({grid.rows}, minmax(0, 1fr))"
  >
    {#each cards as c (c.id)}
      {@const tag = marker(c)}
      {#snippet art()}
        <div class="art" aria-hidden="true">
          {#if c.kind === 'ready' && c.data}
            <RegionMap shapes={c.shapes} fit={c.fit} level={c.data.map.levels[0]?.id ?? 'default'} label="" fills={c.stats?.fills} art={c.data.art} compact />
          {:else}
            <span class="blank"></span>
          {/if}
        </div>
      {/snippet}
      {#snippet info()}
        <div class="info">
          <div class="top">
            <h3>{c.name}</h3>
            {#if c.demo}<span class="chip">dev map</span>{/if}
            {#if c.kind === 'ready' && c.stats}<span class="pct nums">{c.stats.percent}%</span>{/if}
          </div>
          {#if c.kind === 'ready' && c.stats}
            {@const s = c.stats}
            {#if s.core.total > 0 && s.core.total <= 24}
              <div class="seg" role="progressbar" aria-label="Core callouts known" aria-valuemin="0" aria-valuemax={s.core.total} aria-valuenow={s.core.familiar}>
                {#each { length: s.core.total } as _, i}<i class={i < s.core.familiar ? 'd' : ''}></i>{/each}
              </div>
            {:else}
              <div class="fillbar" role="progressbar" aria-label="Mastery" aria-valuemin="0" aria-valuemax="100" aria-valuenow={s.percent}><i style:width="{s.percent}%"></i></div>
            {/if}
            <div class="low">
              <span class="stat">
                {#if s.core.total > 0}
                  <span class="long">Core {s.core.familiar} of {s.core.total}</span><span class="short">Core {s.core.familiar}/{s.core.total}</span>
                {:else}
                  {s.total} callouts
                {/if}
                {#if s.started === 0}<span class="sub"> · not started</span>{/if}
              </span>
              {#if s.due > 0}<span class="chip due">{s.due} due</span>{/if}
            </div>
          {:else}
            <div class="low">
              <span>
                {#if c.kind === 'soon'}Coming{:else if c.kind === 'empty'}No callouts yet{:else}Loading…{/if}
              </span>
            </div>
          {/if}
        </div>
      {/snippet}
      {#if c.kind === 'soon'}
        <article class="card soon {grid.variant}" data-map={c.id} aria-label="{c.name}, coming">
          <div class="thumb">{@render art()}</div>
          {@render info()}
        </article>
      {:else}
        <a class="card active {grid.variant}" class:rec={tag !== null} class:empty={c.kind === 'empty'} data-map={c.id} href="#/map/{c.id}">
          <div class="thumb">{@render art()}</div>
          {#if tag}<span class="tag chip due">{tag}</span>{/if}
          {@render info()}
        </a>
      {/if}
    {/each}
  </main>

  <footer class="hints">
    <span><kbd>←</kbd><kbd>→</kbd> select map</span>
    <span><kbd>enter</kbd> start session</span>
  </footer>
</div>
