<script lang="ts">
  import './editor.css';
  import { listMaps, type MapListing } from './client';
  import Editor from './Editor.svelte';

  let { map }: { map: string | null } = $props();

  let maps = $state.raw<MapListing[]>([]);
  let failure = $state('');
  let loaded = $state(false);

  $effect(() => {
    if (map !== null) return;
    listMaps()
      .then((list) => {
        maps = list;
        loaded = true;
      })
      .catch((e: unknown) => {
        failure = e instanceof Error ? e.message : String(e);
        loaded = true;
      });
  });
</script>

{#if map !== null}
  {#key map}<Editor mapId={map} />{/key}
{:else}
  <div class="app" style:grid-template-rows="var(--bar-h) minmax(0, 1fr)">
    <header class="bar"><span class="brand">callouts</span><span class="crumb"><b>editor</b> · development only</span></header>
    <main class="ed-home" style="overflow:auto">
      <h1>Callout editor</h1>
      <p class="sub">Paint nav areas into callouts, name them, plan screenshots. Reads and writes <code>data/</code>; the nav meshes come from <code>assets/valve/nav</code>.</p>
      {#if !loaded}<p>Loading…</p>
      {:else if failure}<p class="sub">{failure}</p>
      {:else}
        <ul>
          {#each maps as m (m.id)}
            <li>
              <span>{m.displayName} <span class="sub">{m.id}</span></span>
              {#if m.hasData && m.hasNav}<a href="#/editor/{m.id}">Open</a>
              {:else if !m.hasData}<span class="sub">no map record in data/maps</span>
              {:else}<span class="sub">no nav mesh in assets/valve/nav</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
{/if}
