<script lang="ts">
  import type { Callout, Shot } from '../../core/schema';

  // A contrast card (SCOPE §4.6): two callouts the learner keeps mixing up, side by side, with nothing to judge. Like
  // an intro card, it teaches; the Which view? question for the pair follows at once.

  interface Props {
    a: Callout;
    b: Callout;
    shotA: Shot | null;
    shotB: Shot | null;
    neighboursA: readonly Callout[];
    neighboursB: readonly Callout[];
    /** How often the two have been mixed up. */
    confusions: number;
    shotUrl: (file: string) => string;
  }

  let { a, b, shotA, shotB, neighboursA, neighboursB, confusions, shotUrl }: Props = $props();

  const sides = $derived([
    { callout: a, shot: shotA, next: neighboursA },
    { callout: b, shot: shotB, next: neighboursB },
  ]);
</script>

<main class="c-body">
  <div class="c-head">
    <span class="eyebrow">Mixed up {confusions} times · side by side</span>
  </div>
  {#each sides as side (side.callout.id)}
    <section class="c-col" aria-label={side.callout.name}>
      {#if side.shot}
        <div class="plate shot"><img src={shotUrl(side.shot.file)} alt={side.callout.blurb} /></div>
      {/if}
      <div class="c-text">
        <span class="c-name" style="--n:{side.callout.name.length}">{side.callout.name}</span>
        <p class="blurb">{side.callout.blurb}</p>
        <div class="chips">
          {#if side.next.length > 0}
            <span class="eyebrow">Next to</span>
            {#each side.next as n (n.id)}<span class="chip">{n.name}</span>{/each}
          {/if}
        </div>
      </div>
    </section>
  {/each}
</main>
