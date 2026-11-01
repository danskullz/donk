<script lang="ts">
  // Settings (SCOPE.md §5.8): tabbed so it never scrolls (§5.3). Every control writes through `updateSettings` at once,
  // so there is no save button; the one thing that is not instant is anything that deletes, which asks first. The tabs
  // are in screens/settings/; this file is the frame: the bar, the tab row, and the question shown over the panel.

  import { tick } from 'svelte';
  import { getSettings, resetSettings, subscribeSettings } from '../app/settings';
  import '../styles/settings.css';
  import DataTab from './settings/DataTab.svelte';
  import DisplayTab from './settings/DisplayTab.svelte';
  import HardTab from './settings/HardTab.svelte';
  import KeysTab from './settings/KeysTab.svelte';
  import NamingTab from './settings/NamingTab.svelte';
  import { exportLogDb, readNav, TABS, writeNav, type ConfirmSpec, type PartId, type TabId } from './settings/nav';
  import SessionTab from './settings/SessionTab.svelte';

  let settings = $state(getSettings());
  $effect(() => subscribeSettings((s) => (settings = s)));

  const nav = readNav();
  let tab = $state<TabId>(nav.tab);
  let part = $state<PartId>(nav.part);
  const log = exportLogDb();

  const LABELS: Record<TabId, { text: string; more?: string }> = {
    session: { text: 'Session' },
    hard: { text: 'Hard', more: ' mode' },
    naming: { text: 'Naming' },
    display: { text: 'Display' },
    keys: { text: 'Keys' },
    data: { text: 'Data' },
  };

  function select(next: TabId) {
    tab = next;
    writeNav({ tab, part });
  }
  function choosePart(next: PartId) {
    part = next;
    writeNav({ tab, part });
  }

  // Tabs follow the arrow keys, and only the open one is in the tab order (the rest are one arrow key away).
  let tabButtons = $state<Record<string, HTMLButtonElement | undefined>>({});
  function onTabKey(e: KeyboardEvent) {
    const at = TABS.indexOf(tab);
    let to = at;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (at + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (at - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = TABS.length - 1;
    else return;
    e.preventDefault();
    const next = TABS[to];
    if (next) {
      select(next);
      tabButtons[next]?.focus();
    }
  }

  // ---- the question before something that cannot be undone ----
  let confirm = $state.raw<ConfirmSpec | null>(null);
  let cancelButton = $state<HTMLButtonElement>();
  let opener: Element | null = null;
  let working = $state(false);

  async function ask(spec: ConfirmSpec) {
    opener = document.activeElement;
    confirm = spec;
    await tick();
    cancelButton?.focus(); // the safe answer has the focus, so Enter on its own cannot delete anything
  }
  async function close() {
    confirm = null;
    working = false;
    await tick();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }
  async function confirmed() {
    const spec = confirm;
    if (!spec || working) return;
    working = true;
    try {
      await spec.run();
    } finally {
      await close();
    }
  }

  const resetAll = () =>
    ask({
      title: 'Reset all settings?',
      body: 'Every setting goes back to its default. Your progress is not touched.',
      action: 'Reset settings',
      cancel: 'Keep them',
      run: () => void resetSettings(),
    });

  function onkey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (confirm) void close();
    else location.hash = '#/';
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="app settings">
  <header class="bar" inert={confirm !== null}>
    <a class="brand" href="#/" aria-label="callouts, back to the start">callouts</a>
    <span class="crumb set-hide-s"><b>Settings</b></span>
    <span class="grow"></span>
    <button class="btn" type="button" onclick={resetAll}>Reset settings</button>
    <a class="btn primary" href="#/">Done <kbd class="set-hide-s">esc</kbd></a>
  </header>

  <h1 class="sr-only">Settings</h1>

  <div class="set-tabs" inert={confirm !== null}>
    <div class="tabs" role="tablist" aria-label="Settings" tabindex="-1" onkeydown={onTabKey}>
      {#each TABS as id (id)}
        <button
          class="tab"
          type="button"
          role="tab"
          id="set-tab-{id}"
          aria-selected={tab === id}
          aria-controls="set-panel"
          tabindex={tab === id ? 0 : -1}
          bind:this={tabButtons[id]}
          onclick={() => select(id)}
        >
          {LABELS[id].text}{#if LABELS[id].more}<span class="set-hide-s">{LABELS[id].more}</span>{/if}
        </button>
      {/each}
    </div>
  </div>

  <main class="set-body" inert={confirm !== null}>
    <!-- the panel is a div inside <main>: a tabpanel is an interactive role and <main> may not carry one -->
    <div class="set-tabpanel" id="set-panel" role="tabpanel" aria-labelledby="set-tab-{tab}">
      {#if tab === 'session'}
        <SessionTab {settings} />
      {:else if tab === 'hard'}
        <HardTab {settings} />
      {:else if tab === 'naming'}
        <NamingTab {settings} />
      {:else if tab === 'display'}
        <DisplayTab {settings} />
      {:else if tab === 'keys'}
        <KeysTab />
      {:else}
        <DataTab {part} onpart={choosePart} ask={(spec) => void ask(spec)} {log} />
      {/if}
    </div>
  </main>

  {#if confirm}
    <div class="set-confirm" role="alertdialog" aria-labelledby="set-confirm-title" aria-describedby="set-confirm-body">
      <h2 id="set-confirm-title">{confirm.title}</h2>
      <p id="set-confirm-body" class="set-help">{confirm.body}</p>
      <div class="set-actions">
        <button class="btn" type="button" bind:this={cancelButton} onclick={close}>{confirm.cancel}</button>
        <button class="btn set-danger" type="button" disabled={working} onclick={confirmed}>{confirm.action}</button>
      </div>
    </div>
  {/if}
</div>
