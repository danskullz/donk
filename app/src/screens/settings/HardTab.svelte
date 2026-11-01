<script lang="ts">
  import { loadAvailableMaps, type MapData } from '../../app/data';
  import { hardModeFor, updateSettings, type AppSettings } from '../../app/settings';
  import Switch from './Switch.svelte';

  let { settings }: { settings: AppSettings } = $props();

  let maps = $state.raw<MapData[]>([]);
  let failed = $state(false);
  $effect(() => {
    loadAvailableMaps().then(
      (m) => (maps = m),
      () => (failed = true),
    );
  });

  const hardSpots = (m: MapData) => m.callouts.filter((c) => c.tier === 3 && c.status !== 'stale').length;
  const setMap = (id: string, on: boolean) => updateSettings({ hardMode: { ...settings.hardMode, [id]: on } });
</script>

<div class="st-panel">
  <div class="st-col">
    <section class="st-block">
      <h2>Default</h2>
      <Switch label="Hard mode by default" checked={settings.hardModeDefault} onchange={(on) => updateSettings({ hardModeDefault: on })} />
      <p class="st-help">Hard mode adds the smallest spots: boxes, corners, ledges. Progress on them is kept while it is off. A map with no switch of its own follows this one.</p>
    </section>
  </div>

  <div class="st-col">
    <section class="st-block">
      <h2>Per map</h2>
      {#if failed}
        <p class="st-help">The maps could not be loaded.</p>
      {:else}
        <ul class="st-maps">
          {#each maps as m (m.map.id)}
            <li>
              <Switch
                label={m.demo ? `${m.map.displayName} (development)` : m.map.displayName}
                checked={hardModeFor(settings, m.map.id)}
                note={hardSpots(m) === 0 ? 'no hard spots yet' : `${hardSpots(m)} hard spots`}
                onchange={(on) => setMap(m.map.id, on)}
              />
            </li>
          {/each}
        </ul>
        <p class="st-help">The map's own page has the same switch.</p>
      {/if}
    </section>
  </div>
</div>
