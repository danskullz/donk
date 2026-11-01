<script lang="ts">
  import type { SessionSummary } from '../../core/runner';
  import type { SessionPlan } from '../../core/session';
  import { plural, seconds } from './helpers';

  interface Props {
    summary: SessionSummary;
    note: SessionPlan['note'];
    /** How many callouts this map has that could be taught right now. */
    playableCount: number;
    name: (calloutId: string) => string;
    onagain: () => void;
    ondone: () => void;
  }

  let { summary, note, playableCount, name, onagain, ondone }: Props = $props();

  const accuracy = $derived(summary.answered ? Math.round((100 * summary.correct) / summary.answered) : 0);
  const average = $derived(summary.answered ? summary.totalMs / summary.answered : 0);
  const emptyText = $derived(
    playableCount === 0
      ? 'This map has no callouts to learn yet.'
      : note === 'daily-cap'
        ? "You have reached today's limit of answers. Come back tomorrow."
        : 'Nothing is due right now, and there is nothing new to introduce. Come back later.',
  );
</script>

<main class="done-body">
  <div class="done-main">
    <span class="eyebrow">{summary.answered === 0 ? 'No session' : summary.finished ? 'Session complete' : 'Session ended early, everything is saved'}</span>
    {#if summary.answered === 0 && summary.introduced.length === 0}
      <h1>Nothing to do</h1>
      <p class="sub">{emptyText}</p>
    {:else}
      <h1>{summary.correct} / {summary.answered}</h1>
      <div class="stats">
        <span><b>{accuracy}%</b> correct</span>
        <span><b>{seconds(average)}</b> average</span>
        <span><b>{summary.introduced.length}</b> new</span>
      </div>
    {/if}
    <div class="acts">
      {#if summary.answered > 0}<button class="btn primary" type="button" onclick={onagain}>Another round</button>{/if}
      <button class="btn" class:primary={summary.answered === 0} type="button" onclick={ondone}>Done</button>
    </div>
  </div>
  <div class="done-side">
    {#if summary.slowest.length > 0}
      <section>
        <h2>Slowest</h2>
        <ul class="done-list">
          {#each summary.slowest as s (s.calloutId + s.mode)}
            <li><span>{name(s.calloutId)}</span><span class="sub">{seconds(s.latencyMs)}</span></li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if summary.confusions.length > 0}
      <section>
        <h2>Mixed up</h2>
        <ul class="done-list">
          {#each summary.confusions as c (c.target + c.chosen)}
            <li><span>{name(c.target)} for {name(c.chosen)}</span><span class="sub">{plural(c.count, 'time')}</span></li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if summary.mastery.length > 0}
      <section>
        <h2>Moved up</h2>
        <ul class="done-list">
          {#each summary.mastery as m (m.calloutId)}
            <li><span>{name(m.calloutId)}</span><span class="sub">{m.from} → {m.to}</span></li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</main>
