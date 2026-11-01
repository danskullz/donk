<script lang="ts">
  import { parseHash, type Route } from './core/router';
  import Home from './screens/Home.svelte';
  import MapScreen from './screens/Map.svelte';
  import Primer from './screens/Primer.svelte';
  import Progress from './screens/Progress.svelte';
  import Session from './screens/Session.svelte';
  import Settings from './screens/Settings.svelte';
  import Study from './screens/Study.svelte';
  import Summary from './screens/Summary.svelte';

  let route = $state<Route>(parseHash(location.hash));

  $effect(() => {
    const onHashChange = () => (route = parseHash(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });
</script>

{#if route.name === 'home'}
  <Home />
{:else if route.name === 'map'}
  {#key route.map}<MapScreen map={route.map} />{/key}
{:else if route.name === 'session'}
  {#key `${route.map}/${route.zone ?? ''}`}<Session mapId={route.map} zone={route.zone} />{/key}
{:else if route.name === 'study'}
  {#key route.map}<Study map={route.map} />{/key}
{:else if route.name === 'summary'}
  {#key route.map}<Summary map={route.map} />{/key}
{:else if route.name === 'primer'}
  <Primer />
{:else if route.name === 'progress'}
  <Progress />
{:else if route.name === 'settings'}
  <Settings />
{:else if route.name === 'editor'}
  <!-- Development builds only: the condition is written here so the bundler drops the Editor from production. -->
  {#if import.meta.env.DEV}
    {#await import('./editor/EditorRoute.svelte') then editor}
      <editor.default map={route.map} />
    {/await}
  {:else}
    <div class="app shell"><header class="bar"><span class="brand">callouts</span></header><main class="shell-body"><p class="sub">The editor is not part of this build.</p></main></div>
  {/if}
{:else}
  <div class="app shell">
    <header class="bar"><span class="brand">callouts</span></header>
    <main class="shell-body">
      <h1 class="sr-only">callouts</h1>
      <p class="sub">Nothing at {route.hash}. <a href="#/">Back to the start</a></p>
    </main>
  </div>
{/if}

<style>
  .shell {
    grid-template-rows: var(--bar-h) minmax(0, 1fr);
  }
  .shell-body {
    padding: var(--s4);
    overflow: hidden;
  }
</style>
