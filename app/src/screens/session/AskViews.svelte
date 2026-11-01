<script lang="ts">
  import type { Hint, Prompt } from '../../core/quiz';
  import { QUESTION_ALT } from './helpers';

  interface Props {
    prompt: Extract<Prompt, { mode: 'which-view' }>;
    hint: Hint | null;
    number: number;
    shotUrl: (file: string) => string;
    onchoose: (calloutId: string) => void;
  }

  let { prompt, hint, number, shotUrl, onchoose }: Props = $props();

  const gone = (id: string) => hint?.kind === 'eliminate' && hint.calloutId === id;
</script>

<main class="a-body views-body">
  <div class="a-left">
    <div class="views" role="group" aria-label="Views">
      {#each prompt.options as option, i (option.callout.id)}
        <button class="view" type="button" disabled={gone(option.callout.id)} aria-label="View {i + 1}" onclick={() => onchoose(option.callout.id)}>
          <img src={shotUrl(option.shot.file)} alt={QUESTION_ALT} />
          <kbd>{i + 1}</kbd>
        </button>
      {/each}
    </div>
  </div>
  <div class="a-right">
    <div class="prompt">
      <span class="eyebrow">Question {number} · {prompt.options.length} views</span>
      <span class="big">Which view is {prompt.target.name}?</span>
      {#if hint?.kind === 'eliminate'}<span class="hintline">one view is ruled out</span>{/if}
    </div>
    <div class="keys">
      <span><kbd>1</kbd>–<kbd>{prompt.options.length}</kbd> answer, no confirm</span>
      <span><kbd>h</kbd> hint: rules one view out, one rating step</span>
    </div>
  </div>
</main>
