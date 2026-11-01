<script lang="ts">
  import type { Issue } from '../core/validate';

  interface Props {
    issues: readonly Issue[];
    nameOf: (id: string) => string;
    onselect: (id: string) => void;
  }

  let { issues, nameOf, onselect }: Props = $props();

  const errors = $derived(issues.filter((i) => i.severity === 'error'));
  const warnings = $derived(issues.filter((i) => i.severity === 'warning'));
</script>

<div class="ed-panel">
  <p class="ed-note">The same checks as <code>pnpm content:validate</code>, on the file the editor would write, plus what is left out of it.</p>
  {#if issues.length === 0}<p class="ed-empty">Nothing to report.</p>{/if}
  {#each [errors, warnings] as list, n (n)}
    {#if list.length > 0}
      <h2>{n === 0 ? 'Errors' : 'Warnings'} · {list.length}</h2>
      {#each list as i, k (i.rule + (i.callout ?? '') + k)}
        {#if i.callout}
          <button class="ed-issue" class:error={i.severity === 'error'} type="button" onclick={() => onselect(i.callout as string)}>
            <span class="rule">{i.rule} · {nameOf(i.callout)}</span>
            <span>{i.message}</span>
          </button>
        {:else}
          <div class="ed-issue" class:error={i.severity === 'error'}>
            <span class="rule">{i.rule}</span>
            <span>{i.message}</span>
          </div>
        {/if}
      {/each}
    {/if}
  {/each}
</div>
