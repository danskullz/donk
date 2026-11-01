<script lang="ts">
  import RegionMap from '../../components/RegionMap.svelte';
  import { coneFor, type MapShape, type ViewBox } from '../../core/mapview';
  import type { Projection } from '../../core/projection';
  import type { Result } from '../../core/quiz';
  import type { Callout, Shot } from '../../core/schema';

  interface Props {
    /** 'intro' is a first look at a callout: the same screen, with no answer to judge. */
    kind: 'intro' | 'reveal';
    target: Callout;
    shot: Shot | null;
    result: Result | null;
    /** The name of the callout the learner picked or typed, when it was another one. */
    chosenName: string | null;
    /** What was typed, when it matched no callout at all. */
    typedText: string | null;
    introIndex: number;
    introTotal: number;
    neighbours: readonly Callout[];
    /** How often the learner has now mixed the target up with the chosen one. */
    confusions: number;
    shotUrl: (file: string) => string;
    shapes: readonly MapShape[];
    fit: ViewBox;
    proj: Projection;
    mapName: string;
  }

  let { kind, target, shot, result, chosenName, typedText, introIndex, introTotal, neighbours, confusions, shotUrl, shapes, fit, proj, mapName }: Props = $props();

  const cone = $derived(shot ? coneFor(proj, shot, fit) : null);
  const wrong = $derived(kind === 'reveal' && result !== null && !result.correct);
  const eyebrow = $derived(
    kind === 'intro' ? `New · ${introIndex} of ${introTotal}` : !wrong ? (result?.fuzzy ? 'Correct · check the spelling' : 'Correct') : result?.skipped ? 'Skipped' : 'You chose',
  );
</script>

<main class="s-body">
  <div class="s-left">
    {#if shot}
      <div class="plate shot"><img src={shotUrl(shot.file)} alt={target.blurb} /></div>
      <div class="cap">{target.name}<span class="hide-s">&nbsp;· {shot.kind} view</span></div>
    {/if}
    {#if wrong && chosenName && confusions >= 2}
      <div class="confuse">Mixed up with <b>{chosenName}</b> {confusions} times.</div>
    {/if}
  </div>
  <div class="s-right">
    <div class="verdict">
      <span class="eyebrow">{eyebrow}</span>
      {#if wrong && chosenName}
        <span class="miss">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          <span class="nm">{chosenName}</span>
        </span>
      {:else if wrong && typedText}
        <span class="miss">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          <span class="nm">{typedText}</span>
        </span>
      {/if}
      {#if wrong}<span class="eyebrow" style="margin-top:6px">It is</span>{/if}
      <span class="answer" style="--n:{target.name.length}">{target.name}</span>
    </div>
    <div class="plate map-plate">
      <RegionMap {shapes} {fit} level={target.level} label="{target.name} on the {mapName} map{cone ? ', with the camera position and facing' : ''}" truth={target.id} {cone} />
    </div>
    <div class="about"><p class="blurb">{target.blurb}</p></div>
    <div class="chips">
      {#if neighbours.length > 0}
        <span class="eyebrow">Next to</span>
        {#each neighbours as n (n.id)}<span class="chip">{n.name}</span>{/each}
      {/if}
      {#if target.gameplaceName && target.gameplaceName !== target.name}<span class="chip hide-s">game name: {target.gameplaceName}</span>{/if}
    </div>
  </div>
</main>
