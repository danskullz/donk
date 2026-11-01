<script lang="ts">
  import type { Patch } from '../core/editor/doc';
  import { LIMITS, type Callout, type MapRecord } from '../core/schema';

  interface Props {
    callout: Callout;
    map: MapRecord;
    /** Standard callouts a Hard spot may sit in. */
    parents: readonly Callout[];
    all: readonly Callout[];
    suggestions: readonly { id: string; contact: number }[];
    areas: number;
    /** Holes and loose pieces the last repaint left out of the outline. */
    dropped: number;
    unfinishedReasons: readonly string[];
    error: string | null;
    onpatch: (patch: Patch) => void;
    onneighbour: (id: string, on: boolean) => void;
    onclear: () => void;
    ondelete: () => void;
    ontool: (tool: 'brush' | 'polygon' | 'anchor') => void;
  }

  let { callout, map, parents, all, suggestions, areas, dropped, unfinishedReasons, error, onpatch, onneighbour, onclear, ondelete, ontool }: Props = $props();

  let confirming = $state(false);
  $effect(() => {
    void callout.id;
    confirming = false;
  });

  const nameOf = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const suggested = $derived(suggestions.filter((s) => !callout.neighbours.includes(s.id)));
  const candidates = $derived(all.filter((c) => c.id !== callout.id && !callout.neighbours.includes(c.id) && c.tier !== 3));
  let pick = $state('');
</script>

<div class="ed-panel">
  <div class="ed-form">
    <div class="ed-row">
      <label for="f-name">Name</label>
      <input id="f-name" type="text" value={callout.name} maxlength={LIMITS.name + 10} onchange={(e) => onpatch({ name: e.currentTarget.value })} />
      <span class="count" class:bad={callout.name.length > LIMITS.name}>{callout.name.length} / {LIMITS.name}</span>
    </div>
    <div class="ed-row">
      <label for="f-alias">Aliases, separated by commas (typed answers)</label>
      <input id="f-alias" type="text" value={callout.aliases.join(', ')} onchange={(e) => onpatch({ aliases: e.currentTarget.value.split(',') })} />
      <span class="count" class:bad={callout.aliases.length > LIMITS.aliases}>{callout.aliases.length} / {LIMITS.aliases}</span>
    </div>
    <div class="ed-row">
      <div class="two">
        <div class="ed-row">
          <label for="f-zone">Zone</label>
          <select id="f-zone" value={callout.zone} onchange={(e) => onpatch({ zone: e.currentTarget.value })}>
            {#each map.zones as z (z.id)}<option value={z.id}>{z.name}</option>{/each}
          </select>
        </div>
        <div class="ed-row">
          <label for="f-tier">Tier</label>
          <select id="f-tier" value={String(callout.tier)} onchange={(e) => onpatch({ tier: Number(e.currentTarget.value) as 1 | 2 | 3 })}>
            <option value="1">1 · Core</option>
            <option value="2">2 · Standard</option>
            <option value="3">3 · Hard</option>
          </select>
        </div>
      </div>
    </div>
    {#if callout.tier === 3}
      <div class="ed-row">
        <label for="f-parent">Sits inside (a standard callout)</label>
        <select id="f-parent" value={callout.parent ?? ''} onchange={(e) => onpatch({ parent: e.currentTarget.value === '' ? null : e.currentTarget.value })}>
          <option value="">Choose…</option>
          {#each parents as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
    {/if}
    <div class="ed-row">
      <div class="three">
        <div class="ed-row">
          <label for="f-level">Level</label>
          <select id="f-level" value={callout.level} onchange={(e) => onpatch({ level: e.currentTarget.value })}>
            {#each map.levels as l (l.id)}<option value={l.id}>{l.id}</option>{/each}
          </select>
        </div>
        <div class="ed-row">
          <label for="f-order">Route order</label>
          <input id="f-order" type="number" min="0" step="1" value={callout.order ?? ''} onchange={(e) => onpatch({ order: e.currentTarget.value === '' ? undefined : Math.max(0, Math.round(Number(e.currentTarget.value))) })} />
        </div>
        <div class="ed-row">
          <label for="f-status">Status</label>
          <select id="f-status" value={callout.status} onchange={(e) => onpatch({ status: e.currentTarget.value as Callout['status'] })}>
            <option value="draft">draft</option>
            <option value="verified">verified</option>
            <option value="stale">stale</option>
          </select>
        </div>
      </div>
    </div>
    <div class="ed-row">
      <label for="f-game">The game's own name for it (blank if none)</label>
      <input id="f-game" type="text" value={callout.gameplaceName ?? ''} maxlength={LIMITS.gameplaceName + 10} onchange={(e) => onpatch({ gameplaceName: e.currentTarget.value })} />
    </div>
    <div class="ed-row">
      <label for="f-blurb">One line on where it is, relative to what a beginner knows</label>
      <textarea id="f-blurb" value={callout.blurb} onchange={(e) => onpatch({ blurb: e.currentTarget.value })}></textarea>
      <span class="count" class:bad={callout.blurb.length > LIMITS.blurb}>{callout.blurb.length} / {LIMITS.blurb}</span>
    </div>
  </div>

  <h2>Region</h2>
  <div class="ed-form">
    <p class="ed-note">
      {#if areas > 0}{areas} nav areas painted · {callout.region.length} corners
      {:else if callout.region.length >= 3}Drawn by hand · {callout.region.length} corners
      {:else}No region yet.{/if}
    </p>
    {#if dropped > 0}<p class="ed-note warn">{dropped} hole{dropped === 1 ? '' : 's'} or loose piece{dropped === 1 ? '' : 's'} left out of the outline. Fill the hole, or paint the pieces together.</p>{/if}
    <div class="ed-actions">
      <button class="btn" type="button" onclick={() => ontool('brush')}>Paint</button>
      <button class="btn" type="button" onclick={() => ontool('polygon')}>Draw polygon</button>
      <button class="btn" type="button" onclick={() => ontool('anchor')}>Move label point</button>
      <button class="btn" type="button" disabled={callout.region.length === 0} onclick={onclear}>Clear region</button>
    </div>
  </div>

  <h2>Neighbours <span class="count">{callout.neighbours.length} / {LIMITS.neighbours}</span></h2>
  <div class="ed-form">
    <div class="ed-chips">
      {#each callout.neighbours as id (id)}
        <span class="ed-chip">{nameOf(id)}<button type="button" aria-label="Remove {nameOf(id)}" onclick={() => onneighbour(id, false)}>×</button></span>
      {:else}
        <span class="ed-note">None yet.</span>
      {/each}
    </div>
    {#if suggested.length > 0}
      <div class="ed-row">
        <span class="lab">Touching on the map, longest shared edge first</span>
        <div class="ed-chips">
          {#each suggested as s (s.id)}
            <button class="ed-chip add" type="button" title="{s.contact} units of shared edge" onclick={() => onneighbour(s.id, true)}>+ {nameOf(s.id)}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="ed-row">
      <label for="f-nb">Add another</label>
      <select id="f-nb" bind:value={pick} onchange={() => { if (pick !== '') onneighbour(pick, true); pick = ''; }}>
        <option value="">Choose…</option>
        {#each candidates as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </div>
    {#if error}<p class="ed-note warn">{error}</p>{/if}
  </div>

  {#if unfinishedReasons.length > 0}
    <p class="ed-note warn">Not in the content file yet: {unfinishedReasons.join('; ')}.</p>
  {/if}
  <div class="ed-actions">
    {#if confirming}
      <button class="btn danger" type="button" onclick={ondelete}>Really delete {callout.name}</button>
      <button class="btn" type="button" onclick={() => (confirming = false)}>Keep it</button>
    {:else}
      <button class="btn danger" type="button" onclick={() => (confirming = true)}>Delete callout</button>
    {/if}
  </div>
</div>
