<script lang="ts">
  import { suggest, type NameEntry } from '../../core/match';
  import type { Hint, Prompt } from '../../core/quiz';
  import { QUESTION_ALT } from './helpers';

  interface Props {
    prompt: Extract<Prompt, { mode: 'name-typed' }>;
    hint: Hint | null;
    number: number;
    shotUrl: (file: string) => string;
    entries: readonly NameEntry[];
    /** Callout id -> the name of its zone, shown at the end of a suggestion. */
    zoneOf: (calloutId: string) => string;
    onsubmit: (text: string) => void;
  }

  let { prompt, hint, number, shotUrl, entries, zoneOf, onsubmit }: Props = $props();

  let text = $state('');
  let hl = $state(-1);
  let input = $state<HTMLInputElement>();

  const rows = $derived(prompt.suggestions && text.trim() !== '' ? suggest(text, entries, 5) : []);

  $effect(() => {
    input?.focus();
  });

  // A new suggestion list starts with nothing highlighted: Enter then answers with what was typed.
  $effect(() => {
    void text;
    hl = -1;
  });

  /** The matched start of a suggestion in the accent colour. */
  function split(label: string): [string, string] {
    const typed = text.trim();
    return label.toLowerCase().startsWith(typed.toLowerCase()) ? [label.slice(0, typed.length), label.slice(typed.length)] : ['', label];
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      hl = (hl + step + rows.length + (hl < 0 && step < 0 ? 1 : 0)) % rows.length;
    } else if (e.key === 'Tab' && rows.length > 0) {
      e.preventDefault();
      text = rows[Math.max(hl, 0)]?.text ?? text;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = hl >= 0 ? rows[hl]?.text : text;
      if (picked && picked.trim() !== '') onsubmit(picked);
    }
  }
</script>

<main class="a-body">
  <div class="a-left">
    <div class="plate shot"><img src={shotUrl(prompt.shot.file)} alt={QUESTION_ALT} /></div>
    <div class="cap">Plate {String(number).padStart(2, '0')}</div>
  </div>
  <div class="a-right">
    <div class="prompt">
      <span class="eyebrow">Question {number} · suggestions {prompt.suggestions ? 'on' : 'off'}</span>
      <span class="big">Type the name</span>
      {#if hint?.kind === 'letter'}<span class="hintline">starts with <b>{hint.text}</b></span>{/if}
    </div>
    <div class="a-field">
      <div class="field">
        <span class="pre" aria-hidden="true">&gt;</span>
        <input
          bind:this={input}
          bind:value={text}
          {onkeydown}
          type="text"
          role="combobox"
          aria-label="Name of this place"
          aria-expanded={rows.length > 0}
          aria-controls="suggestions"
          aria-autocomplete={prompt.suggestions ? 'list' : 'none'}
          aria-activedescendant={hl >= 0 ? `sug-${hl}` : undefined}
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
        />
      </div>
      {#if rows.length > 0}
        <div class="sugg" id="suggestions" role="listbox" aria-label="Suggestions">
          {#each rows as row, i (row.calloutId)}
            {@const [lead, rest] = split(row.text)}
            <button class="sug" class:hl={i === hl} id="sug-{i}" type="button" role="option" aria-selected={i === hl} onclick={() => onsubmit(row.text)}>
              <span class="t"><b>{lead}</b>{rest}</span>
              <span class="z">{zoneOf(row.calloutId)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="keys">
      {#if prompt.suggestions}<span><kbd>↑</kbd><kbd>↓</kbd> pick</span><span><kbd>tab</kbd> complete</span>{/if}
      <span><kbd>enter</kbd> answer</span>
      <span><kbd>alt</kbd>+<kbd>h</kbd> hint: the first letter, one rating step</span>
    </div>
  </div>
</main>
