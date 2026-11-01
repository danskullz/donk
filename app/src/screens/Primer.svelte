<script lang="ts">
  // The first-run primer (SCOPE.md §4.11, §5.5): one skippable screen that says what a callout is, what the spawns and
  // the sites are, and how to read the radar, for someone who may not know the game at all. It says nothing about any one
  // map: what is true of a particular map belongs to that map's callouts. "Got it" and "Skip" both mark it seen, so the
  // Home screen stops sending the learner here, and go to Home; Settings links back here to read it again.
  import { getSettings, updateSettings } from '../app/settings';

  /** Read once: a primer opened again from Settings has nothing to skip. */
  const seen = getSettings().primerSeen;
  let primary = $state<HTMLButtonElement>();

  // Enter then means "got it" without reaching for the mouse.
  $effect(() => primary?.focus());

  function leave() {
    updateSettings({ primerSeen: true });
    // replace, not push: Back from Home should not land on the primer again
    location.replace('#/');
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      leave();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="app pr">
  <header class="bar">
    <span class="brand">callouts</span>
    <span class="crumb"><b>Primer</b></span>
  </header>

  <main class="pr-body">
    <div class="pr-head">
      <h1>How callouts work</h1>
      <p class="pr-sub sub">Four short things. If you already play, skip it.</p>
    </div>

    <div class="pr-cards">
      <section class="pr-card">
        <svg class="pr-pic" viewBox="0 0 120 64" aria-hidden="true">
          <rect x="6" y="8" width="34" height="48" class="area" />
          <rect x="44" y="8" width="38" height="22" class="hot" />
          <rect x="44" y="34" width="38" height="22" class="area" />
          <rect x="86" y="8" width="28" height="48" class="area" />
          <circle cx="63" cy="19" r="3.2" class="pin" />
          <path d="M63 19 100 19" class="leader" />
          <rect x="88" y="13" width="27" height="12" class="tag" />
        </svg>
        <div>
          <h2>A callout is a name for a place</h2>
          <p>Players shout it to tell teammates where something is: “one at A”. This app teaches the names.</p>
        </div>
      </section>

      <section class="pr-card">
        <svg class="pr-pic" viewBox="0 0 120 64" aria-hidden="true">
          <path d="M26 46 94 18" class="route" />
          <circle cx="22" cy="48" r="11" class="t" />
          <text x="22" y="52" text-anchor="middle" class="lab t-ink">T</text>
          <circle cx="98" cy="16" r="11" class="ct" />
          <text x="98" y="20" text-anchor="middle" class="lab ct-ink">CT</text>
        </svg>
        <div>
          <h2>Two teams, two spawns</h2>
          <p>T attack from one end of the map. CT defend from the other. You learn the routes from a spawn first.</p>
        </div>
      </section>

      <section class="pr-card">
        <svg class="pr-pic" viewBox="0 0 120 64" aria-hidden="true">
          <rect x="14" y="14" width="34" height="36" class="site" />
          <text x="31" y="38" text-anchor="middle" class="lab">A</text>
          <rect x="72" y="14" width="34" height="36" class="site" />
          <text x="89" y="38" text-anchor="middle" class="lab">B</text>
        </svg>
        <div>
          <h2>Two bombsites, A and B</h2>
          <p>Most maps have two. T try to plant the bomb on one of them. CT try to stop them.</p>
        </div>
      </section>

      <section class="pr-card">
        <svg class="pr-pic" viewBox="0 0 120 64" aria-hidden="true">
          <path d="M30 56V12" class="north" />
          <path d="m24 20 6-10 6 10Z" class="head" />
          <text x="30" y="62" text-anchor="middle" class="lab small">N</text>
          <path d="M78 46 104 26 106 52Z" class="cone" />
          <circle cx="78" cy="46" r="3.2" class="pin" />
        </svg>
        <div>
          <h2>The map never turns</h2>
          <p>North is always up, whichever way you face. The small triangle on a screenshot's map shows where it was taken and what it looks at.</p>
        </div>
      </section>
    </div>

    <div class="pr-foot">
      <button bind:this={primary} class="btn primary" type="button" onclick={leave}>Got it</button>
      {#if !seen}<button class="btn" type="button" onclick={leave}>Skip</button>{/if}
      <span class="pr-keys sub"><kbd>Enter</kbd> {seen ? 'back to the maps' : 'got it'}{#if !seen}{' '}<kbd>Esc</kbd> skip{/if}</span>
    </div>
  </main>
</div>

<style>
  .pr {
    grid-template-rows: var(--bar-h) minmax(0, 1fr);
  }
  .pr-body {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--s5);
    width: 100%;
    max-width: 960px;
    min-height: 0;
    margin: 0 auto;
    padding: var(--s6);
  }
  .pr-head h1 {
    font-size: var(--fs-hero);
    line-height: 1.05;
    font-weight: 600;
    letter-spacing: -0.04em;
  }
  .pr-sub {
    margin-top: var(--s1);
  }

  .pr-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: var(--s4);
    min-height: 0;
  }
  .pr-card {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: var(--s3);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: var(--s4);
    background: var(--surface);
  }
  .pr-card h2 {
    margin-bottom: var(--s1);
    font-size: var(--fs-lg);
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .pr-card p {
    color: var(--sub);
    font-size: var(--fs-md);
  }

  .pr-pic {
    width: 100%;
    height: 100%;
    min-height: 0;
    max-height: 120px;
    color: var(--text);
  }
  .pr-pic .area {
    fill: var(--m-new);
    stroke: var(--rule-strong);
    stroke-width: 1;
  }
  .pr-pic .hot {
    fill: var(--m-learning);
    stroke: var(--main);
    stroke-width: 2;
  }
  .pr-pic .pin {
    fill: var(--main);
  }
  .pr-pic .leader {
    stroke: var(--main);
    stroke-width: 1.2;
    fill: none;
  }
  .pr-pic .tag {
    fill: var(--bg);
    stroke: var(--main);
    stroke-width: 1.2;
  }
  .pr-pic .route {
    stroke: var(--rule-strong);
    stroke-width: 1.5;
    stroke-dasharray: 3 4;
    fill: none;
  }
  .pr-pic .t {
    fill: var(--t);
  }
  .pr-pic .ct {
    fill: var(--ct);
  }
  .pr-pic .lab {
    fill: var(--text);
    font: 600 13px var(--font);
  }
  .pr-pic .lab.small {
    font-size: 10px;
    fill: var(--sub);
  }
  .pr-pic .t-ink,
  .pr-pic .ct-ink {
    fill: var(--main-ink);
    font-size: 11px;
  }
  .pr-pic .site {
    fill: var(--m-new);
    stroke: var(--main);
    stroke-width: 2;
  }
  .pr-pic .north {
    stroke: var(--text);
    stroke-width: 1.8;
    fill: none;
  }
  .pr-pic .head {
    fill: var(--text);
  }
  .pr-pic .cone {
    fill: var(--main);
    fill-opacity: 0.35;
    stroke: var(--main);
    stroke-width: 1.2;
  }

  .pr-foot {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .pr-foot .btn {
    height: 44px;
  }
  .pr-keys {
    margin-left: var(--s3);
    font-size: var(--fs-xs);
  }
  .pr-keys kbd + kbd {
    margin-left: var(--s2);
  }

  /* a phone upright: one column, the picture beside its words */
  @media (max-width: 820px) and (max-aspect-ratio: 4/3) {
    .pr-body {
      gap: var(--s3);
      padding: var(--s3);
    }
    .pr-head h1 {
      font-size: 24px;
    }
    /* the Skip button says as much, and the four cards need the room */
    .pr-sub {
      display: none;
    }
    .pr-cards {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: repeat(4, minmax(0, 1fr));
      gap: var(--s2);
    }
    .pr-card {
      grid-template-columns: 84px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      align-items: center;
      gap: var(--s3);
      padding: var(--s2) var(--s3);
    }
    .pr-card h2 {
      font-size: var(--fs-md);
      margin-bottom: 2px;
    }
    .pr-card p {
      font-size: var(--fs-sm);
      line-height: 1.4;
    }
    .pr-pic {
      max-height: 56px;
    }
    .pr-foot .btn {
      flex: 1;
    }
    .pr-keys {
      display: none;
    }
  }

  /* a phone on its side: the same four cards compressed, the picture beside its words */
  @media (max-height: 520px) and (min-aspect-ratio: 4/3) {
    .pr-body {
      gap: var(--s2);
      padding: var(--s3) var(--s4);
    }
    .pr-head {
      display: flex;
      align-items: baseline;
      gap: var(--s4);
    }
    .pr-head h1 {
      font-size: 20px;
    }
    .pr-sub {
      margin: 0;
      font-size: var(--fs-xs);
    }
    .pr-cards {
      gap: var(--s2);
    }
    .pr-card {
      grid-template-columns: 64px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      align-items: center;
      gap: var(--s2);
      padding: var(--s2);
    }
    .pr-card h2 {
      font-size: var(--fs-sm);
      margin-bottom: 2px;
    }
    .pr-card p {
      font-size: var(--fs-xs);
      line-height: 1.35;
    }
    .pr-pic {
      max-height: 40px;
    }
    .pr-foot .btn {
      height: 34px;
    }
  }
</style>
