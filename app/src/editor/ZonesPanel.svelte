<script lang="ts">
  import type { MapRecord } from '../core/schema';

  interface Props {
    zones: MapRecord['zones'];
    count: (zone: string) => number;
    error: string | null;
    onadd: (name: string) => void;
    onrename: (id: string, name: string) => void;
    onmove: (id: string, by: -1 | 1) => void;
    onremove: (id: string) => void;
  }

  let { zones, count, error, onadd, onrename, onmove, onremove }: Props = $props();
  let name = $state('');
</script>

<div class="ed-panel">
  <p class="ed-note">Zones group callouts for learning (SCOPE §4.3) and are listed in route order, from spawn toward the sites. Intro cards follow this order.</p>
  {#each zones as z, i (z.id)}
    <div class="ed-zonerow">
      <input type="text" aria-label="Name of zone {z.id}" value={z.name} maxlength="28" onchange={(e) => onrename(z.id, e.currentTarget.value)} />
      <span class="ed-note">{count(z.id)}</span>
      <span class="ed-actions">
        <button class="btn" type="button" aria-label="Move {z.name} earlier" disabled={i === 0} onclick={() => onmove(z.id, -1)}>↑</button>
        <button class="btn" type="button" aria-label="Move {z.name} later" disabled={i === zones.length - 1} onclick={() => onmove(z.id, 1)}>↓</button>
      </span>
      <button class="btn danger" type="button" aria-label="Remove {z.name}" onclick={() => onremove(z.id)}>Remove</button>
    </div>
  {/each}
  {#if error}<p class="ed-note warn">{error}</p>{/if}
  <form
    class="ed-new"
    onsubmit={(e) => {
      e.preventDefault();
      if (name.trim() !== '') onadd(name);
      name = '';
    }}
  >
    <input type="text" placeholder="New zone name" aria-label="New zone name" bind:value={name} maxlength="28" />
    <button class="btn primary" type="submit" disabled={name.trim() === ''}>Add zone</button>
  </form>
</div>
