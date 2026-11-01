<script lang="ts">
  import type { SessionSummary } from '../../core/runner';
  import type { SessionPlan } from '../../core/session';
  import { plural, seconds } from './helpers';

  interface Props {
    summary: SessionSummary;
    note: SessionPlan['note'];
    /** How many callouts this map has that could be taught right now. */
    playableCount: number;
    /** Nothing was due, and the items closest to due could be practised instead. */
    canPractise: boolean;
    name: (calloutId: string) => string;
    onagain: () => void;
    onpractise: () => void;
    ondone: () => void;
    /** The full Summary screen for this map. */
    onsummary: () => void;
  }

  let { summary, note, playableCount, canPractise, name, onagain, onpractise, ondone, onsummary }: Props = $props();

  const accuracy = $derived(summary.answered ? Math.round((100 * summary.correct) / summary.answered) : 0);
  const average = $derived(summary.answered ? summary.totalMs / summary.answered : 0);
  const empty = $derived(summary.answered === 0 && summary.introduced.length === 0);
  const early = $derived(summary.earlyPractice === true);
  const emptyText = $derived(
    playableCount === 0
      ? 'This map has no callouts to learn yet.'
      : note === 'daily-cap'
        ? "You have reached today's limit of answers. Come back tomorrow."
        : canPractise
          ? 'Nothing is due right now, and there is nothing new to introduce. You can practise the items closest to due.'
          : 'Nothing is due right now, and there is nothing new to introduce. Come back later.',
  );
  const eyebrow = $derived(
    summary.answered === 0
      ? 'No session'
      : !summary.finished
        ? 'Session ended early, everything is saved'
        : early
          ? 'Early practice complete'
          : summary.endedBy === 'time'
            ? 'Time is up, session complete'
            : 'Session complete',
  );
</script>

<main class="done-body">
  <div class="done-main">
    <span class="eyebrow">{eyebrow}</span>
    {#if empty}
      <h1>Nothing to do</h1>
      <p class="sub">{emptyText}</p>
    {:else}
      <h1>{summary.correct} / {summary.answered}</h1>
      <div class="stats">
        <span><b>{accuracy}%</b> correct</span>
        <span><b>{seconds(average)}</b> average</span>
        <span><b>{summary.introduced.length}</b> new</span>
      </div>
      {#if early}<p class="sub">Early practice: nothing here was due yet, so it moves the next review out less.</p>{/if}
    {/if}
    <div class="acts">
      {#if empty && canPractise}
        <button class="btn primary" type="button" onclick={onpractise}>Practise anyway</button>
      {:else if summary.answered > 0}
        <button class="btn primary" type="button" onclick={onagain}>Another round</button>
      {/if}
      <button class="btn" class:primary={summary.answered === 0 && !(empty && canPractise)} type="button" onclick={ondone}>Done</button>
      {#if !empty}<button class="btn" type="button" onclick={onsummary}>Full summary</button>{/if}
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
