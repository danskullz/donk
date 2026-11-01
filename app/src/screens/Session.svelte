<script lang="ts">
  import { startSession, type StartedSession } from '../app/start-session';
  import type { Point } from '../core/geometry';
  import { fitView, shapesFor } from '../core/mapview';
  import { entriesFor, pickShot, type AnswerInput } from '../core/quiz';
  import type { RunnerView } from '../core/runner';
  import type { Callout, Shot } from '../core/schema';
  import type { SaveStatus } from '../core/store';
  import { itemKey } from '../core/types';
  import AskChoice from './session/AskChoice.svelte';
  import AskPoint from './session/AskPoint.svelte';
  import AskTyped from './session/AskTyped.svelte';
  import AskViews from './session/AskViews.svelte';
  import Done from './session/Done.svelte';
  import { MODE_LABEL, seconds } from './session/helpers';
  import PointReveal from './session/PointReveal.svelte';
  import Reveal from './session/Reveal.svelte';
  import { installTestHook } from './session/test-hook';

  let { mapId, zone }: { mapId: string; zone?: string | undefined } = $props();

  // A reveal ignores the continue key for a moment, so a double Enter after a typed answer cannot skip it unread.
  const KEY_GUARD_MS = 300;

  let boot = $state<'loading' | 'ready' | 'unknown' | 'error'>('loading');
  let session = $state.raw<StartedSession | null>(null);
  let view = $state.raw<RunnerView | null>(null);
  let save = $state<SaveStatus>({ pending: 0, failing: false });
  let typed = $state<string | null>(null);
  let root = $state<HTMLDivElement>();
  let primary = $state<HTMLButtonElement>();
  let changedAt = 0;
  let generation = 0;

  installTestHook(() => view);

  async function begin(id: string) {
    const mine = ++generation;
    boot = 'loading';
    session = null;
    view = null;
    try {
      const query = new URLSearchParams(location.search);
      const seed = query.get('seed');
      const started = await startSession(id, {
        zone,
        seed: seed === null ? undefined : Number(seed),
        includeDraft: query.has('draft'),
        onSaveStatus: (s) => (save = s),
      });
      if (mine !== generation) return;
      if (!started) {
        boot = 'unknown';
        return;
      }
      session = started;
      view = started.runner.view;
      boot = 'ready';
    } catch (e) {
      console.error(e);
      if (mine === generation) boot = 'error';
    }
  }

  $effect(() => {
    void begin(mapId);
    return () => {
      generation += 1;
    };
  });

  // ---- what the screens need, derived once ----
  const map = $derived(session?.data.map ?? null);
  const playable = $derived(session?.playable ?? []);
  const shapes = $derived(map ? shapesFor(playable, map.projection) : []);
  const fit = $derived(fitView(shapes));
  const entries = $derived(entriesFor(playable));
  const byId = $derived(new Map(playable.map((c) => [c.id, c])));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const zoneName = (zone: string) => map?.zones.find((z) => z.id === zone)?.name ?? zone;
  const shotUrl = (file: string) => (session ? session.data.shotUrl(file) : '');
  const levels = $derived(map?.levels.map((l) => l.id) ?? []);

  const neighbours = (target: Callout) => target.neighbours.map((id) => byId.get(id)).filter((c): c is Callout => c !== undefined);
  const primaryShot = (target: Callout): Shot | null => target.shots.find((s) => s.kind === 'approach') ?? target.shots[0] ?? null;
  const zoneMembers = (zone: string) => new Set(playable.filter((c) => c.zone === zone).map((c) => c.id));

  // ---- actions ----
  function answer(input: AnswerInput) {
    if (!session || view?.phase !== 'question') return;
    typed = input.kind === 'typed' ? input.text : null;
    view = session.runner.answer(input);
  }
  const choose = (calloutId: string) => answer({ kind: 'choice', calloutId });
  const place = (world: Point, level: string) => answer({ kind: 'point', x: world[0], y: world[1], level });
  const next = () => {
    if (session) view = session.runner.continue();
  };
  const hint = () => {
    if (session && view?.phase === 'question' && !view.hint) view = session.runner.hint();
  };
  const skip = () => {
    if (session && view?.phase === 'question') answer({ kind: 'skip' });
  };
  const leave = () => {
    if (session && view?.phase !== 'done') view = session.runner.leave();
  };
  const home = () => {
    location.hash = '#/';
  };

  // ---- reactions to the phase changing ----
  $effect(() => {
    const phase = view?.phase;
    if (!phase) return;
    changedAt = performance.now();
    void session?.saver.flush();
    // Keyboard focus follows the screen: the continue button on a reveal, the typed field by itself, else the shell.
    const typedQuestion = view?.phase === 'question' && view.prompt.mode === 'name-typed';
    queueMicrotask(() => {
      if (phase === 'reveal' || phase === 'intro') primary?.focus();
      else if (!typedQuestion) root?.focus();
    });
  });

  // The next picture is fetched while the current card is on screen, so it appears at once.
  $effect(() => {
    const s = session;
    const v = view;
    if (!s || !v || v.phase === 'done') return;
    const upcoming = s.runner.upcoming;
    const callout = upcoming ? s.playable.find((c) => c.id === upcoming.calloutId) : undefined;
    if (!upcoming || !callout || callout.shots.length === 0) return;
    let shot: Shot | undefined;
    if (upcoming.type === 'intro') shot = primaryShot(callout) ?? undefined;
    else if (upcoming.mode === 'name-mc' || upcoming.mode === 'name-typed' || upcoming.mode === 'where-am-i') {
      shot = pickShot(callout, itemKey(callout.id, upcoming.mode), s.derived.items.get(itemKey(callout.id, upcoming.mode))?.answers ?? 0);
    }
    if (shot) new Image().src = s.data.shotUrl(shot.file);
  });

  // Time away from the tab does not count against an answer.
  function visibility() {
    if (!session) return;
    if (document.hidden) session.runner.pause();
    else session.runner.resume();
  }

  function onkey(e: KeyboardEvent) {
    if (!session || !view || e.ctrlKey || e.metaKey || e.repeat) return;
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (view.phase !== 'done') leave();
      return;
    }
    if (view.phase === 'intro' || view.phase === 'reveal') {
      if (key === ' ' || key === 'enter') {
        // Handled here so a focused button does not also click and move on twice.
        e.preventDefault();
        if (performance.now() - changedAt >= KEY_GUARD_MS) next();
      }
      return;
    }
    if (view.phase !== 'question') return;
    // In the typed field, letters belong to the answer; help is on Alt there.
    if (inField ? !e.altKey : e.altKey) return;
    if (key === 'h') {
      e.preventDefault();
      hint();
    } else if (key === 's') {
      e.preventDefault();
      skip();
    } else if (!inField && (view.prompt.mode === 'name-mc' || view.prompt.mode === 'read-map' || view.prompt.mode === 'which-view')) {
      const i = Number(key) - 1;
      const options = view.prompt.mode === 'which-view' ? view.prompt.options.map((o) => o.callout) : view.prompt.options;
      const picked = Number.isInteger(i) ? options[i] : undefined;
      if (picked && !(view.prompt.mode === 'which-view' && view.hint?.kind === 'eliminate' && view.hint.calloutId === picked.id)) {
        e.preventDefault();
        choose(picked.id);
      }
    }
  }

  // ---- text for the bar and the screen reader ----
  const ticks = $derived.by(() => {
    if (!view) return [];
    const { done, total } = view.progress;
    return Array.from({ length: total }, (_, i) => (i < done ? 'd' : i === done && view?.phase === 'question' ? 'c' : ''));
  });
  const counter = $derived.by(() => {
    if (!view) return '';
    if (view.phase === 'intro') return `new ${view.introIndex} / ${view.introTotal}`;
    const n = view.phase === 'question' ? view.progress.done + 1 : view.progress.done;
    return `${n} / ${view.progress.total}`;
  });
  const crumb = $derived(view?.phase === 'question' || view?.phase === 'reveal' ? MODE_LABEL[view.prompt.mode] : view?.phase === 'intro' ? 'New callouts' : 'Done');
  const announcement = $derived.by(() => {
    if (!view) return '';
    if (view.phase === 'intro') return `New callout ${view.introIndex} of ${view.introTotal}: ${view.callout.name}. ${view.callout.blurb}`;
    if (view.phase === 'question') return `Question ${view.progress.done + 1} of ${view.progress.total}. ${MODE_LABEL[view.prompt.mode]}.`;
    if (view.phase === 'reveal') {
      const { result, prompt } = view;
      if (result.correct) return `Correct. ${prompt.target.name}.`;
      const picked = result.chosen ? ` You chose ${nameOf(result.chosen)}.` : result.skipped ? ' You skipped.' : '';
      return `Wrong. It is ${prompt.target.name}.${picked}`;
    }
    return 'Session finished.';
  });
  const typedQuestion = $derived(view?.phase === 'question' && view.prompt.mode === 'name-typed');
</script>

<svelte:window onkeydown={onkey} />
<svelte:document onvisibilitychange={visibility} />

{#if boot !== 'ready' || !session || !view || !map}
  <div class="app" style:grid-template-rows="var(--bar-h) minmax(0, 1fr)">
    <header class="bar"><span class="brand">callouts</span></header>
    <main class="notice">
      {#if boot === 'loading'}
        <p>Loading…</p>
      {:else if boot === 'unknown'}
        <h1>No such map</h1>
        <p>There is no map called {mapId}. <a href="#/">Back to the start</a></p>
      {:else}
        <h1>Could not start the session</h1>
        <p>The map data or the browser's storage failed to load. The console has the details.</p>
        <button class="btn primary" type="button" onclick={() => begin(mapId)}>Try again</button>
      {/if}
    </main>
  </div>
{:else}
  <div class="app session" class:typeq={typedQuestion} class:ending={view.phase === 'done'} bind:this={root} tabindex="-1">
    <header class="bar">
      <span class="brand">callouts</span>
      <span class="crumb"><b>{map.displayName}</b> · {crumb}</span>
      {#if session.volatile}<span class="chip warn">progress is not being saved</span>{:else if save.failing}<span class="chip warn">not saved, retrying</span>{/if}
      <span class="grow"></span>
      <div class="seg" role="progressbar" aria-label="Question" aria-valuemin="0" aria-valuemax={view.progress.total} aria-valuenow={view.progress.done}>
        {#each ticks as tick}<i class={tick}></i>{/each}
      </div>
      <span class="nums">{counter}</span>
      <span class="nums hide-s">{view.phase === 'reveal' ? seconds(view.outcome.latencyMs) : ''}</span>
    </header>

    {#if view.phase === 'intro'}
      <Reveal
        kind="intro"
        target={view.callout}
        shot={primaryShot(view.callout)}
        result={null}
        chosenName={null}
        typedText={null}
        introIndex={view.introIndex}
        introTotal={view.introTotal}
        neighbours={neighbours(view.callout)}
        confusions={0}
        {shotUrl}
        {shapes}
        {fit}
        proj={map.projection}
        mapName={map.displayName}
      />
    {:else if view.phase === 'question'}
      {@const prompt = view.prompt}
      {#if prompt.mode === 'name-mc' || prompt.mode === 'read-map'}
        {#key prompt}<AskChoice {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} {shapes} {fit} onchoose={choose} />{/key}
      {:else if prompt.mode === 'which-view'}
        {#key prompt}<AskViews {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} onchoose={choose} />{/key}
      {:else if prompt.mode === 'name-typed'}
        {#key prompt}<AskTyped {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} {entries} zoneOf={(id) => zoneName(byId.get(id)?.zone ?? '')} onsubmit={(text) => answer({ kind: 'typed', text })} />{/key}
      {:else if prompt.mode === 'pin' || prompt.mode === 'where-am-i'}
        {#key prompt}<AskPoint {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} {shapes} {fit} proj={map.projection} {levels} mapName={map.displayName} {zoneMembers} onpoint={place} />{/key}
      {/if}
    {:else if view.phase === 'reveal'}
      {@const prompt = view.prompt}
      {@const chosenName = view.result.chosen && !view.result.correct ? nameOf(view.result.chosen) : null}
      {#if prompt.mode === 'pin' || prompt.mode === 'where-am-i'}
        <PointReveal {prompt} result={view.result} {chosenName} neighbours={neighbours(prompt.target)} {shotUrl} {shapes} {fit} proj={map.projection} mapName={map.displayName} />
      {:else}
        <Reveal
          kind="reveal"
          target={prompt.target}
          shot={prompt.mode === 'which-view' ? (prompt.options.find((o) => o.callout.id === prompt.target.id)?.shot ?? null) : prompt.mode === 'read-map' ? primaryShot(prompt.target) : prompt.shot}
          result={view.result}
          {chosenName}
          typedText={prompt.mode === 'name-typed' && !view.result.chosen ? typed : null}
          introIndex={0}
          introTotal={0}
          neighbours={neighbours(prompt.target)}
          confusions={view.outcome.confusions}
          {shotUrl}
          {shapes}
          {fit}
          proj={map.projection}
          mapName={map.displayName}
        />
      {/if}
    {:else}
      <Done summary={view.summary} note={session.plan.note} playableCount={playable.length} name={nameOf} onagain={() => begin(mapId)} ondone={home} />
    {/if}

    {#if view.phase !== 'done'}
      <footer class="foot">
        <span class="hide-s"><kbd>esc</kbd> leave</span>
        <span class="grow"></span>
        {#if view.phase === 'question'}
          <button class="btn" type="button" disabled={view.hint !== null} onclick={hint}>hint <kbd class="hide-s">{typedQuestion ? 'alt+h' : 'h'}</kbd></button>
          <button class="btn" type="button" onclick={skip}>skip <kbd class="hide-s">{typedQuestion ? 'alt+s' : 's'}</kbd></button>
        {:else}
          <span class="hide-s"><kbd>Space</kbd></span>
          <button class="btn primary" type="button" bind:this={primary} onclick={next}>Continue</button>
        {/if}
      </footer>
    {/if}
    <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
  </div>
{/if}

<style>
  .app:focus {
    outline: none;
  }
</style>
