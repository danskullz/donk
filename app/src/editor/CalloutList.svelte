<script lang="ts">
  import type { Callout, MapRecord } from '../core/schema';

  interface Props {
    callouts: readonly Callout[];
    zones: MapRecord['zones'];
    selected: string | null;
    /** Callouts that are not in the content file yet. */
    unfinished: ReadonlySet<string>;
    /** Callouts with a validation error. */
    broken: ReadonlySet<string>;
    areaCount: (id: string) => number;
    onselect: (id: string) => void;
    oncreate: (name: string, zone: string, tier: 1 | 2 | 3) => void;
  }

  let { callouts, zones, selected, unfinished, broken, areaCount, onselect, oncreate }: Props = $props();

  let query = $state('');
  let name = $state('');
  let zone = $state('');
  let tier = $state('2');
  // until a zone is chosen, the first one is shown and used
  const chosenZone = $derived(zone !== '' && zones.some((z) => z.id === zone) ? zone : (zones[0]?.id ?? ''));

  const shown = $derived(callouts.filter((c) => query.trim() === '' || `${c.name} ${c.aliases.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = $derived(
    zones.map((z) => ({ zone: z, items: shown.filter((c) => c.zone === z.id).sort((a, b) => a.tier - b.tier || (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name)) })),
  );
  const stray = $derived(shown.filter((c) => !zones.some((z) => z.id === c.zone)));

  function create(e: SubmitEvent) {
    e.preventDefault();
    if (name.trim() === '') return;
    oncreate(name, chosenZone, Number(tier) as 1 | 2 | 3);
    name = '';
  }
</script>

<div class="ed-panel">
  <form class="ed-new" onsubmit={create}>
    <input type="text" placeholder="New callout name" aria-label="New callout name" bind:value={name} maxlength="28" />
    <button class="btn primary" type="submit" disabled={name.trim() === ''}>Add</button>
    <select aria-label="Zone of the new callout" value={chosenZone} onchange={(e) => (zone = e.currentTarget.value)}>
      {#each zones as z (z.id)}<option value={z.id}>{z.name}</option>{/each}
    </select>
    <select aria-label="Tier of the new callout" bind:value={tier}>
      <option value="1">Tier 1 · Core</option>
      <option value="2">Tier 2 · Standard</option>
      <option value="3">Tier 3 · Hard</option>
    </select>
  </form>
  <input type="search" placeholder="Find a callout" aria-label="Find a callout" bind:value={query} />

  <div class="ed-list">
    {#each groups as g (g.zone.id)}
      <div class="ed-zone"><span>{g.zone.name}</span><span>{g.items.length}</span></div>
      {#each g.items as c (c.id)}
        <button class="ed-item" type="button" aria-current={c.id === selected} onclick={() => onselect(c.id)}>
          <span class="dot" class:done={!unfinished.has(c.id)} class:bad={broken.has(c.id)} title={broken.has(c.id) ? 'has an error' : unfinished.has(c.id) ? 'not in the content file yet' : 'in the content file'}></span>
          <span class="nm">{c.name}</span>
          <span class="n">{areaCount(c.id) || ''}</span>
          <span class="tier">T{c.tier}</span>
        </button>
      {/each}
    {/each}
    {#if stray.length > 0}
      <div class="ed-zone"><span>Unknown zone</span><span>{stray.length}</span></div>
      {#each stray as c (c.id)}
        <button class="ed-item" type="button" aria-current={c.id === selected} onclick={() => onselect(c.id)}>
          <span class="dot bad"></span><span class="nm">{c.name}</span><span class="n"></span><span class="tier">T{c.tier}</span>
        </button>
      {/each}
    {/if}
    {#if callouts.length === 0}<p class="ed-empty">No callouts yet. Name one above, then paint its area on the map.</p>{/if}
  </div>
</div>
