<script lang="ts">
  import type { Hint, Prompt } from '../../core/quiz';
  import { QUESTION_ALT } from './helpers';

  // Speed call (SCOPE §4.2): the picture shows for `prompt.flashMs`, then hides, then the learner names it. The
  // runner owns the clock: this component only reports (`onhide`) that the picture has been up for its whole time.
  // The countdown is the one place a clock is visible (SCOPE §4.11).

  interface Props {
    prompt: Extract<Prompt, { mode: 'speed' }>;
    hint: Hint | null;
    number: number;
    /** The picture is still meant to be showing; the runner turns this off after `onhide`. */
    flashing: boolean;
    /** Reduced motion: the time is counted in whole seconds and nothing drains or fades. */
    reduced: boolean;
    shotUrl: (file: string) => string;
    onhide: () => void;
    onchoose: (calloutId: string) => void;
  }

  let { prompt, hint, number, flashing, reduced, shotUrl, onhide, onchoose }: Props = $props();

  // The flash starts when the picture is loaded, never before: a slow image must not eat the time the learner gets.
  const LOAD_GIVE_UP_MS = 4000;
  let loaded = $state(false);
  let away = $state(false);
  let left = $state(0);

  $effect(() => {
    const img = new Image();
    const done = () => (loaded = true);
    img.onload = done;
    img.onerror = done;
    img.src = shotUrl(prompt.shot.file);
    const giveUp = setTimeout(done, LOAD_GIVE_UP_MS);
    return () => clearTimeout(giveUp);
  });

  // Running while the picture is up and the tab is in view. If the tab is hidden mid-flash the clock stops and the
  // flash starts over when it comes back: the learner did not get to see it.
  $effect(() => {
    if (!flashing || !loaded || away) return;
    const t0 = performance.now();
    left = prompt.flashMs;
    const tick = setInterval(() => (left = Math.max(0, prompt.flashMs - (performance.now() - t0))), 100);
    const end = setTimeout(onhide, prompt.flashMs);
    return () => {
      clearInterval(tick);
      clearTimeout(end);
    };
  });

  const showing = $derived(flashing && loaded && !away);
  const countdown = $derived(reduced ? `${Math.max(1, Math.ceil(left / 1000))} s` : `${(left / 1000).toFixed(1)} s`);
  const ruled = (name: string) => hint?.kind === 'letter' && !name.toLowerCase().startsWith(hint.text.toLowerCase());
</script>

<svelte:document onvisibilitychange={() => (away = document.hidden)} />

<main class="a-body">
  <div class="a-left">
    <div class="plate shot speed-shot" class:gone={!flashing}>
      {#if showing}
        <img src={shotUrl(prompt.shot.file)} alt={QUESTION_ALT} />
      {:else}
        <div class="speed-blank"><span>{flashing ? 'Get ready' : 'Gone'}</span></div>
      {/if}
    </div>
    <div class="cap speed-cap">
      <span>Plate {String(number).padStart(2, '0')}</span>
      {#if flashing}
        {#if showing && !reduced}
          <span class="speed-bar" aria-hidden="true"><i style:animation-duration="{prompt.flashMs}ms"></i></span>
        {/if}
        <span class="speed-count" aria-hidden="true">{showing ? countdown : ''}</span>
      {/if}
    </div>
  </div>
  <div class="a-right">
    <div class="prompt">
      <span class="eyebrow">Question {number} · speed call · {prompt.options.length} choices</span>
      <span class="big">{flashing ? 'Look' : 'Where was that?'}</span>
      {#if hint?.kind === 'letter'}<span class="hintline">starts with <b>{hint.text}</b></span>{/if}
    </div>
    <div class="opts" class:waiting={flashing} role="group" aria-label="Answers" inert={flashing}>
      {#each prompt.options as option, i (option.id)}
        <button class="opt" class:ruled={ruled(option.name)} type="button" onclick={() => onchoose(option.id)}>
          <kbd>{i + 1}</kbd><span class="lab">{option.name}</span>
        </button>
      {/each}
    </div>
    <div class="keys">
      <span><kbd>1</kbd>–<kbd>{prompt.options.length}</kbd> answer once the picture is gone</span>
      <span><kbd>h</kbd> hint: the first letter, one rating step</span>
    </div>
  </div>
</main>
