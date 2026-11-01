<script lang="ts">
  import { reportSession, startSession, type StartedSession } from '../app/start-session';
  import { getSettings } from '../app/settings';
  import type { Point } from '../core/geometry';
  import { fitView, shapesFor } from '../core/mapview';
  import { entriesFor, pickShot, type AnswerInput } from '../core/quiz';
  import type { RunnerView, SessionSummary } from '../core/runner';
  import type { Callout, Shot } from '../core/schema';
  import type { SaveStatus } from '../core/store';
  import { itemKey } from '../core/types';
  import AskChoice from './session/AskChoice.svelte';
  import AskPoint from './session/AskPoint.svelte';
  import AskSpeed from './session/AskSpeed.svelte';
  import AskTyped from './session/AskTyped.svelte';
  import AskViews from './session/AskViews.svelte';
  import Contrast from './session/Contrast.svelte';
  import Done from './session/Done.svelte';
  import { MODE_LABEL, motionReduced, seconds } from './session/helpers';
  import PointReveal from './session/PointReveal.svelte';
  import Reveal from './session/Reveal.svelte';
  import { flashFromQuery, installTestHook } from './session/test-hook';

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

  /** `earlyPractice`: "Practise anyway", the items closest to due when nothing is (the end screen offers it). */
  async function begin(id: string, earlyPractice = false) {
    // A session being replaced was left on its end screen, where the summary was already handed over.
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
        earlyPractice,
        flashMs: flashFromQuery(query),
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

  // The Summary screen is handed every session that ends (SCOPE §4.3 step 5): on the end screen, and also when the
  // learner walks away mid-session (browser back, a link), unless nothing at all had happened yet, so that opening
  // and leaving a session does not wipe out the summary of the last real one. What was answered is saved already.
  let reported: SessionSummary | null = null;
  $effect(() => {
    if (session && view?.phase === 'done' && view.summary !== reported) {
      reported = view.summary;
      reportSession(session, view.summary);
    }
  });
  $effect(() => () => {
    if (!session || !view || view.phase === 'done') return;
    const ended = session.runner.leave();
    if (ended.phase === 'done' && (ended.summary.answered > 0 || ended.summary.introduced.length > 0)) reportSession(session, ended.summary);
  });

  // Speed call draws its own countdown, so it needs to know whether motion is wanted. Settings cannot change while a
  // session is on screen, so one reading at the start is enough.
  const reduced = motionReduced(getSettings().reducedMotion, typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

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
  // Speed call: the picture has been up for its whole time. From here the question can be answered and is timed.
  const flashEnded = () => {
    if (session && view?.phase === 'question' && view.flashing) view = session.runner.flashEnded();
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
    // Keyboard focus follows the screen: the continue button on a card or reveal, the typed field by itself, else the shell.
    const typedQuestion = view?.phase === 'question' && view.prompt.mode === 'name-typed';
    queueMicrotask(() => {
      if (phase === 'reveal' || phase === 'intro' || phase === 'contrast') primary?.focus();
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
    if (!upcoming || !callout) return;
    const shots: (Shot | null)[] = [];
    if (upcoming.type === 'intro') shots.push(primaryShot(callout));
    else if (upcoming.type === 'contrast') shots.push(primaryShot(callout), primaryShot(s.playable.find((c) => c.id === upcoming.otherId) ?? callout));
    else if (callout.shots.length > 0 && (upcoming.mode === 'name-mc' || upcoming.mode === 'name-typed' || upcoming.mode === 'where-am-i' || upcoming.mode === 'speed')) {
      const key = itemKey(callout.id, upcoming.mode);
      shots.push(pickShot(callout, key, s.derived.items.get(key)?.answers ?? 0));
    }
    for (const shot of shots) if (shot) new Image().src = s.data.shotUrl(shot.file);
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
    if (view.phase === 'intro' || view.phase === 'contrast' || view.phase === 'reveal') {
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
    } else if (!inField && !view.flashing && (view.prompt.mode === 'name-mc' || view.prompt.mode === 'read-map' || view.prompt.mode === 'which-view' || view.prompt.mode === 'speed')) {
      // Speed call takes no answer while its picture is up: the runner would ignore the key, and so does this.
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
    if (view.phase === 'contrast') return 'compare';
    const n = view.phase === 'question' ? view.progress.done + 1 : view.progress.done;
    return `${n} / ${view.progress.total}`;
  });
  const crumb = $derived(
    view?.phase === 'question' || view?.phase === 'reveal' ? MODE_LABEL[view.prompt.mode] : view?.phase === 'intro' ? 'New callouts' : view?.phase === 'contrast' ? 'Mixed up' : 'Done',
  );
  const announcement = $derived.by(() => {
    if (!view) return '';
    if (view.phase === 'intro') return `New callout ${view.introIndex} of ${view.introTotal}: ${view.callout.name}. ${view.callout.blurb}`;
    if (view.phase === 'contrast') return `Mixed up ${view.confusions} times: ${view.a.name} and ${view.b.name}. ${view.a.name}: ${view.a.blurb} ${view.b.name}: ${view.b.blurb}`;
    if (view.phase === 'question') {
      const where = `Question ${view.progress.done + 1} of ${view.progress.total}. ${MODE_LABEL[view.prompt.mode]}.`;
      // The picture of a Speed call is gone before it can be answered: say so, because nothing else on screen does.
      return view.prompt.mode !== 'speed' ? where : view.flashing ? `${where} Look at the picture.` : `${where} The picture is gone. Choose the name.`;
    }
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
      {#if session.plan.earlyPractice}<span class="chip">early practice</span>{/if}
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
    {:else if view.phase === 'contrast'}
      <Contrast
        a={view.a}
        b={view.b}
        shotA={primaryShot(view.a)}
        shotB={primaryShot(view.b)}
        neighboursA={neighbours(view.a)}
        neighboursB={neighbours(view.b)}
        confusions={view.confusions}
        {shotUrl}
      />
    {:else if view.phase === 'question'}
      {@const prompt = view.prompt}
      {#if prompt.mode === 'name-mc' || prompt.mode === 'read-map'}
        {#key prompt}<AskChoice {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} {shapes} {fit} onchoose={choose} />{/key}
      {:else if prompt.mode === 'which-view'}
        {#key prompt}<AskViews {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} onchoose={choose} />{/key}
      {:else if prompt.mode === 'name-typed'}
        {#key prompt}<AskTyped {prompt} hint={view.hint} number={view.progress.done + 1} {shotUrl} {entries} zoneOf={(id) => zoneName(byId.get(id)?.zone ?? '')} onsubmit={(text) => answer({ kind: 'typed', text })} />{/key}
      {:else if prompt.mode === 'speed'}
        {#key prompt}<AskSpeed {prompt} hint={view.hint} number={view.progress.done + 1} flashing={view.flashing} {reduced} {shotUrl} onhide={flashEnded} onchoose={choose} />{/key}
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
      <Done
        summary={view.summary}
        note={session.plan.note}
        playableCount={playable.length}
        canPractise={session.canPracticeEarly}
        name={nameOf}
        onagain={() => begin(mapId, session?.plan.earlyPractice === true)}
        onpractise={() => begin(mapId, true)}
        ondone={home}
        onsummary={() => (location.hash = `#/summary/${mapId}`)}
      />
    {/if}

    {#if view.phase !== 'done'}
      <footer class="foot">
        <span class="hide-s"><kbd>esc</kbd> leave</span>
        <span class="grow"></span>
        {#if view.phase === 'question'}
          <button class="btn" type="button" disabled={view.hint !== null || view.flashing} onclick={hint}>hint <kbd class="hide-s">{typedQuestion ? 'alt+h' : 'h'}</kbd></button>
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
