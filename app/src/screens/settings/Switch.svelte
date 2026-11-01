<script lang="ts">
  // An on/off choice. A real checkbox with role="switch" (Space flips it), drawn like the comps' switch: a small box
  // with a square that slides. The state is also written out, so colour is never the only signal.

  interface Props {
    label: string;
    checked: boolean;
    onchange: (checked: boolean) => void;
    /** Shown after the label, in muted text. */
    note?: string;
  }

  let { label, checked, onchange, note }: Props = $props();
</script>

<label class="st-switch">
  <input type="checkbox" role="switch" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
  <i aria-hidden="true"></i>
  <span class="st-switch-label">{label}</span>
  {#if note}<span class="sub st-switch-note">{note}</span>{/if}
  <span class="st-switch-state" aria-hidden="true">{checked ? 'on' : 'off'}</span>
</label>
