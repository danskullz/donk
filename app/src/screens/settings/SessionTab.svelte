<script lang="ts">
  import { SESSION_LENGTHS, sessionLengthOf, updateSettings, type AppSettings, type SessionLength } from '../../app/settings';
  import Segmented from './Segmented.svelte';
  import Switch from './Switch.svelte';

  let { settings }: { settings: AppSettings } = $props();

  const lengths = SESSION_LENGTHS.map((l) => ({ value: l.id, label: l.label }));
  const counts = Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

  const length = $derived(sessionLengthOf(settings));
  const percent = $derived(Math.round(settings.retention * 100));
  // "9 in 10", or "8.7 in 10" off the round numbers
  const inTen = $derived((percent / 10).toFixed(percent % 10 === 0 ? 0 : 1));

  function chooseLength(id: string) {
    const choice = SESSION_LENGTHS.find((l) => l.id === (id as SessionLength));
    if (choice) updateSettings(choice.patch);
  }
  const custom = $derived(
    [settings.sessionMinutes !== null ? `${settings.sessionMinutes} min` : null, settings.sessionCards !== null ? `${settings.sessionCards} cards` : null].filter(Boolean).join(' and '),
  );
</script>

<div class="st-panel">
  <div class="st-col">
    <section class="st-block">
      <h2>Session length</h2>
      <Segmented label="Session length" options={lengths} value={length} onchoose={chooseLength} />
      <p class="st-help">
        {#if length === null}Now set to {custom}, which is not one of these. Pick one to replace it.{:else}A session ends at this limit or when nothing more is due. <kbd>Esc</kbd> ends it at any time; everything answered is saved.{/if}
      </p>
    </section>

    <section class="st-block">
      <h2>New callouts per session</h2>
      <Segmented label="New callouts per session" options={counts} value={String(settings.newPerSession)} columns={8} onchoose={(v) => updateSettings({ newPerSession: Number(v) })} />
      <p class="st-help">How many callouts one session may introduce. Fewer is gentler. While many reviews are due, no new ones come at all.</p>
    </section>
  </div>

  <div class="st-col">
    <section class="st-block">
      <h2>How much to remember</h2>
      <div class="st-range">
        <input
          type="range"
          min="85"
          max="95"
          step="1"
          value={percent}
          aria-label="Target recall"
          aria-valuetext="{percent} percent"
          oninput={(e) => updateSettings({ retention: Number(e.currentTarget.value) / 100 })}
        />
        <output class="nums" aria-hidden="true">{percent}%</output>
      </div>
      <div class="st-range-ends sub"><span>fewer reviews</span><span>fewer misses</span></div>
      <p class="st-help">At {percent}% you should get about {inTen} in 10 right when a card comes back. Higher: cards return sooner, so more reviews. Lower: fewer reviews, more misses.</p>
    </section>

    <section class="st-block">
      <h2>Gentle start</h2>
      <Switch label="Three choices at first" checked={settings.gentleStart} onchange={(on) => updateSettings({ gentleStart: on })} />
      <p class="st-help">A new callout's first multiple-choice question has three answers instead of four.</p>
    </section>
  </div>
</div>
