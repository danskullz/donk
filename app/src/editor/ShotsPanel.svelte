<script lang="ts">
  import type { PlannedShot } from '../core/editor/doc';
  import type { Callout, Shot } from '../core/schema';

  interface Props {
    callout: Callout;
    planned: readonly PlannedShot[];
    /** The names of the regions each planned shot's view reaches, by index. */
    sees: readonly (readonly string[])[];
    onpropose: () => void;
    onchange: (index: number, shot: PlannedShot) => void;
    onremove: (index: number) => void;
    onaim: (index: number) => void;
    ontool: () => void;
  }

  let { callout, planned, sees, onpropose, onchange, onremove, onaim, ontool }: Props = $props();

  const need = $derived(callout.tier === 3 ? 2 : 3);
  const have = $derived(callout.shots.length);
  const num = (e: Event & { currentTarget: HTMLInputElement }) => Number(e.currentTarget.value);
  const kinds: Shot['kind'][] = ['approach', 'alternate', 'inside', 'overview'];
</script>

<div class="ed-panel">
  <p class="ed-note">
    {callout.name} needs at least {need} shots. {have} captured, {planned.length} planned.
    Planned shots are saved with the editor's work and written to <code>data/editor/*.capture-manifest.json</code> for the capture driver; positions are eye positions.
  </p>
  <div class="ed-actions">
    <button class="btn primary" type="button" disabled={callout.region.length < 3} onclick={onpropose}>Propose shots</button>
    <button class="btn" type="button" onclick={ontool}>Place one on the map</button>
  </div>
  {#if callout.region.length < 3}<p class="ed-note warn">Paint or draw the region first: proposals come from its shape.</p>{/if}

  {#each planned as shot, i (i)}
    <div class="ed-shot">
      <header>
        <strong>Shot {i + 1}</strong>
        <span class="ed-actions">
          <button class="btn" type="button" onclick={() => onaim(i)}>Aim at label</button>
          <button class="btn danger" type="button" aria-label="Remove shot {i + 1}" onclick={() => onremove(i)}>Remove</button>
        </span>
      </header>
      <div class="three">
        <div class="ed-row"><label for="s{i}-x">x</label><input id="s{i}-x" type="number" step="1" value={shot.pos[0]} onchange={(e) => onchange(i, { ...shot, pos: [num(e), shot.pos[1], shot.pos[2]] })} /></div>
        <div class="ed-row"><label for="s{i}-y">y</label><input id="s{i}-y" type="number" step="1" value={shot.pos[1]} onchange={(e) => onchange(i, { ...shot, pos: [shot.pos[0], num(e), shot.pos[2]] })} /></div>
        <div class="ed-row"><label for="s{i}-z">z (eye)</label><input id="s{i}-z" type="number" step="1" value={shot.pos[2]} onchange={(e) => onchange(i, { ...shot, pos: [shot.pos[0], shot.pos[1], num(e)] })} /></div>
      </div>
      <div class="three">
        <div class="ed-row"><label for="s{i}-yaw">yaw</label><input id="s{i}-yaw" type="number" step="1" value={shot.yaw} onchange={(e) => onchange(i, { ...shot, yaw: num(e) })} /></div>
        <div class="ed-row"><label for="s{i}-pitch">pitch</label><input id="s{i}-pitch" type="number" step="1" value={shot.pitch} onchange={(e) => onchange(i, { ...shot, pitch: Math.max(-90, Math.min(90, num(e))) })} /></div>
        <div class="ed-row">
          <label for="s{i}-stance">stance</label>
          <select id="s{i}-stance" value={shot.stance} onchange={(e) => onchange(i, { ...shot, stance: e.currentTarget.value as PlannedShot['stance'] })}>
            <option value="stand">stand</option>
            <option value="crouch">crouch</option>
          </select>
        </div>
      </div>
      <div class="ed-row">
        <label for="s{i}-kind">kind</label>
        <select id="s{i}-kind" value={shot.kind} onchange={(e) => onchange(i, { ...shot, kind: e.currentTarget.value as PlannedShot['kind'] })}>
          {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
        </select>
      </div>
      <p class="ed-note">In view: {sees[i]?.length ? sees[i]?.join(', ') : 'nothing painted yet'} (walls are not considered).</p>
    </div>
  {/each}

  {#if callout.shots.length > 0}
    <h2>Captured</h2>
    {#each callout.shots as s (s.file)}
      <p class="ed-note">{s.kind} · {s.file} · yaw {s.yaw} · {s.stance} · {s.captured}</p>
    {/each}
  {/if}
</div>
