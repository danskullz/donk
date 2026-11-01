<script lang="ts">
  import RegionMap from '../../components/RegionMap.svelte';
  import type { Point } from '../../core/geometry';
  import type { MapShape, ViewBox } from '../../core/mapview';
  import { pixelToWorld, type Projection } from '../../core/projection';
  import type { Hint, Prompt } from '../../core/quiz';
  import { QUESTION_ALT } from './helpers';

  interface Props {
    prompt: Extract<Prompt, { mode: 'pin' | 'where-am-i' }>;
    hint: Hint | null;
    number: number;
    shotUrl: (file: string) => string;
    shapes: readonly MapShape[];
    fit: ViewBox;
    proj: Projection;
    levels: readonly string[];
    mapName: string;
    /** The callouts of the zone the hint lights up. */
    zoneMembers: (zone: string) => ReadonlySet<string>;
    onpoint: (world: Point, level: string) => void;
  }

  let { prompt, hint, number, shotUrl, shapes, fit, proj, levels, mapName, zoneMembers, onpoint }: Props = $props();

  // The floor shown starts on the first one, so the question does not say which floor the answer is on.
  let chosenLevel = $state<string | null>(null);
  const level = $derived(chosenLevel ?? prompt.level);
  const lit = $derived(hint?.kind === 'zone' ? zoneMembers(hint.zone) : null);

  function pick(pixel: Point) {
    onpoint(pixelToWorld(proj, pixel[0], pixel[1]), level);
  }
</script>

<main class="p-body" class:has-shot={prompt.mode === 'where-am-i'}>
  <div class="plate p-map">
    <RegionMap {shapes} {fit} {level} {lit} interactive names label="{mapName} map, answer surface" onpick={pick} />
    <div class="mapfoot">
      <div class="cap">Click a region · no confirm step</div>
      {#if levels.length > 1}
        <div class="tabs" role="tablist" aria-label="Floor">
          {#each levels as id (id)}
            <button class="tab" type="button" role="tab" aria-selected={id === level} onclick={() => (chosenLevel = id)}>{id}</button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <div class="p-right">
    {#if prompt.mode === 'where-am-i'}
      <div class="plate shot p-shot"><img src={shotUrl(prompt.shot.file)} alt={QUESTION_ALT} /></div>
      <div class="prompt">
        <span class="eyebrow">Question {number} · click where you are</span>
        <span class="big">Where is this?</span>
        {#if hint?.kind === 'zone'}<span class="hintline">the zone is lit on the map</span>{/if}
      </div>
    {:else}
      <div class="verdict asking">
        <span class="eyebrow">Question {number} · Pin it</span>
        <span class="answer" style="--n:{prompt.target.name.length}">{prompt.target.name}</span>
        {#if hint?.kind === 'zone'}<span class="hintline">the zone is lit on the map</span>{/if}
      </div>
    {/if}
    <div class="keys">
      <span>click or tap where it is</span>
      <span>scroll or pinch to zoom, drag to pan</span>
      <span><kbd>tab</kbd> in, arrows move, <kbd>enter</kbd> picks</span>
      <span><kbd>h</kbd> hint: lights up the zone, one rating step</span>
    </div>
  </div>
</main>
