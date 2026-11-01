<script lang="ts">
  import RegionMap, { type Mark } from '../../components/RegionMap.svelte';
  import { coneFor, type MapShape, type ViewBox } from '../../core/mapview';
  import { worldToPixel, type Projection } from '../../core/projection';
  import type { Prompt, Result } from '../../core/quiz';
  import type { Callout } from '../../core/schema';
  import { plural } from './helpers';

  interface Props {
    prompt: Extract<Prompt, { mode: 'pin' | 'where-am-i' }>;
    result: Result;
    chosenName: string | null;
    neighbours: readonly Callout[];
    shotUrl: (file: string) => string;
    shapes: readonly MapShape[];
    fit: ViewBox;
    proj: Projection;
    mapName: string;
  }

  let { prompt, result, chosenName, neighbours, shotUrl, shapes, fit, proj, mapName }: Props = $props();

  const target = $derived(prompt.target);
  const guess = $derived(result.guess ? worldToPixel(proj, result.guess[0], result.guess[1]) : null);
  const cone = $derived(prompt.mode === 'where-am-i' ? coneFor(proj, prompt.shot, fit) : null);
  const wrong = $derived(!result.correct);
  const marks = $derived<Mark[]>([
    ...(wrong && result.chosen ? [{ id: result.chosen, text: chosenName ?? '', tone: 'chosen' as const }] : []),
    { id: target.id, text: target.name, tone: 'truth' },
  ]);
  const verb = $derived(prompt.mode === 'pin' ? 'You pinned' : 'You placed');
  const caption = $derived(
    result.correct ? 'Inside the region' : result.hops === null ? 'Guess to truth' : result.hops === 1 ? 'Guess to truth · 1 region away' : `Guess to truth · ${result.hops} regions away`,
  );
</script>

<main class="p-body" class:has-shot={prompt.mode === 'where-am-i'}>
  <div class="plate p-map">
    <RegionMap {shapes} {fit} level={target.level} label="{mapName} map: your guess and the answer" truth={target.id} chosen={wrong ? result.chosen : null} {guess} {cone} {marks} />
    <div class="mapfoot"><div class="cap">{caption}</div></div>
  </div>
  <div class="p-right">
    {#if prompt.mode === 'where-am-i'}
      <div class="plate shot p-shot"><img src={shotUrl(prompt.shot.file)} alt={target.blurb} /></div>
    {/if}
    <div class="verdict">
      <span class="eyebrow">{result.correct ? 'Correct' : result.skipped ? 'Skipped' : verb}</span>
      {#if wrong && !result.skipped}
        <span class="miss">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          <span class="nm">{chosenName ?? 'Empty ground'}</span>
        </span>
      {/if}
      {#if wrong}<span class="eyebrow" style="margin-top:6px">It is here</span>{/if}
      <span class="answer" style="--n:{target.name.length}">{target.name}</span>
      {#if wrong && result.hops !== null && result.hops > 0}
        <div class="off">
          <span class="chip">{plural(result.hops, 'region')} away</span>
          {#if result.close}<span class="sub">close, still counts as wrong</span>{/if}
        </div>
      {/if}
    </div>
    <div class="about">
      <p class="blurb">{target.blurb}</p>
      {#if neighbours.length > 0}
        <div class="chips">
          <span class="eyebrow">Next to</span>
          {#each neighbours as n (n.id)}<span class="chip">{n.name}</span>{/each}
        </div>
      {/if}
    </div>
  </div>
</main>
