<script lang="ts">
  import RegionMap from '../../components/RegionMap.svelte';
  import type { MapShape, ViewBox } from '../../core/mapview';
  import type { Hint, Prompt } from '../../core/quiz';
  import { QUESTION_ALT } from './helpers';

  interface Props {
    prompt: Extract<Prompt, { mode: 'name-mc' | 'read-map' }>;
    hint: Hint | null;
    number: number;
    shotUrl: (file: string) => string;
    shapes: readonly MapShape[];
    fit: ViewBox;
    onchoose: (calloutId: string) => void;
  }

  let { prompt, hint, number, shotUrl, shapes, fit, onchoose }: Props = $props();

  const ruled = (name: string) => hint?.kind === 'letter' && !name.toLowerCase().startsWith(hint.text.toLowerCase());
</script>

<main class="a-body" class:map-body={prompt.mode === 'read-map'}>
  <div class="a-left">
    {#if prompt.mode === 'name-mc'}
      <div class="plate shot"><img src={shotUrl(prompt.shot.file)} alt={QUESTION_ALT} /></div>
      <div class="cap">Plate {String(number).padStart(2, '0')}</div>
    {:else}
      <div class="plate mapplate">
        <RegionMap {shapes} {fit} level={prompt.target.level} label="The map, with one area lit" truth={prompt.target.id} />
      </div>
      <div class="cap">The lit area</div>
    {/if}
  </div>
  <div class="a-right">
    <div class="prompt">
      <span class="eyebrow">Question {number} · {prompt.options.length} choices</span>
      <span class="big">{prompt.mode === 'name-mc' ? 'Where is this?' : 'What is this place?'}</span>
      {#if hint?.kind === 'letter'}<span class="hintline">starts with <b>{hint.text}</b></span>{/if}
    </div>
    <div class="opts" role="group" aria-label="Answers">
      {#each prompt.options as option, i (option.id)}
        <button class="opt" class:ruled={ruled(option.name)} type="button" onclick={() => onchoose(option.id)}>
          <kbd>{i + 1}</kbd><span class="lab">{option.name}</span>
        </button>
      {/each}
    </div>
    <div class="keys">
      <span><kbd>1</kbd>–<kbd>{prompt.options.length}</kbd> answer, no confirm</span>
      <span><kbd>h</kbd> hint: the first letter, one rating step</span>
    </div>
  </div>
</main>
