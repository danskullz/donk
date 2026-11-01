<script lang="ts">
  import { updateSettings, type AppSettings } from '../../app/settings';
  import Segmented from './Segmented.svelte';
  import Switch from './Switch.svelte';

  let { settings }: { settings: AppSettings } = $props();

  const motion = [
    { value: 'system', label: 'Like my device' },
    { value: 'on', label: 'Reduce' },
    { value: 'off', label: 'Full' },
  ];
</script>

<div class="st-panel">
  <div class="st-col">
    <section class="st-block">
      <h2>Sound</h2>
      <Switch label="Sound" note="no sounds yet" checked={settings.sound} onchange={(on) => updateSettings({ sound: on })} />
      <p class="st-help">There are no sounds in the app yet, so this does nothing. Your choice is kept for when there are.</p>
    </section>

    <section class="st-block">
      <h2>Motion</h2>
      <Segmented label="Motion" options={motion} value={settings.reducedMotion} onchoose={(v) => updateSettings({ reducedMotion: v as AppSettings['reducedMotion'] })} />
      <p class="st-help">Reduce stops every animation and fade. It overrides what your device asks for, in either direction.</p>
    </section>
  </div>

  <div class="st-col">
    <section class="st-block">
      <h2>First-run intro</h2>
      <p class="st-help">The short primer on what a callout is and how to read the map.</p>
      <a class="btn st-link" href="#/primer">Show the primer again</a>
    </section>
  </div>
</div>
