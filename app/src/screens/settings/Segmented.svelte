<script lang="ts">
  // One choice out of a few, as a row of buttons. Real radio buttons underneath, so the browser gives the keyboard
  // behaviour for free: Tab enters the group, the arrow keys move and choose, and a screen reader says "1 of 4".

  interface Option {
    value: string;
    label: string;
  }
  interface Props {
    /** Names the group for a screen reader. */
    label: string;
    options: readonly Option[];
    /** The chosen value, or null when none of the options matches (a hand-edited setting). */
    value: string | null;
    onchoose: (value: string) => void;
    /** Equal columns, for short labels such as 1 to 8. Otherwise the options share the row by their text. */
    columns?: number;
  }

  let { label, options, value, onchoose, columns }: Props = $props();
  const group = $props.id();
</script>

<div class="set-seg" class:set-seg-grid={columns !== undefined} role="radiogroup" aria-label={label} style:--cols={columns}>
  {#each options as o (o.value)}
    <label class="set-seg-opt">
      <input type="radio" name={group} value={o.value} checked={value === o.value} onchange={() => onchoose(o.value)} />
      <span>{o.label}</span>
    </label>
  {/each}
</div>
