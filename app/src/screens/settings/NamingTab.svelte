<script lang="ts">
  import { loadAvailableMaps } from '../../app/data';
  import { updateSettings, type AppSettings } from '../../app/settings';
  import { displayName, otherName, type Naming } from '../../core/naming';

  let { settings }: { settings: AppSettings } = $props();
  const group = $props.id();

  // A callout the game and the community name differently shows what the choice does. The first real one from a built
  // map is used; until there is one, the pair from the scope document.
  let example = $state<{ name: string; gameplaceName: string }>({ name: 'Short', gameplaceName: 'ShortStairs' });
  $effect(() => {
    void loadAvailableMaps().then((maps) => {
      for (const m of maps.filter((x) => !x.demo)) {
        const c = m.callouts.find((x) => x.gameplaceName !== null && x.gameplaceName.toLowerCase() !== x.name.toLowerCase());
        if (c?.gameplaceName) {
          example = { name: c.name, gameplaceName: c.gameplaceName };
          return;
        }
      }
    });
  });

  const OPTIONS: readonly { id: Naming; label: string }[] = [
    { id: 'both', label: 'Both names' },
    { id: 'community', label: 'Community names only' },
    { id: 'game', label: 'Game names only' },
  ];

  function shown(naming: Naming): string {
    const first = displayName(example, naming);
    const second = otherName(example, naming);
    return second ? `${first}, the game calls it ${second}` : first;
  }
</script>

<div class="st-panel st-one">
  <section class="st-block">
    <h2>Callout names</h2>
    <div class="st-picks" role="radiogroup" aria-label="Callout names">
      {#each OPTIONS as o (o.id)}
        <label class="st-pick">
          <input type="radio" name={group} value={o.id} checked={settings.naming === o.id} onchange={() => updateSettings({ naming: o.id })} />
          <span class="st-pick-body">
            <span class="st-pick-label">{o.label}</span>
            <span class="sub st-pick-example">{shown(o.id)}</span>
          </span>
        </label>
      {/each}
    </div>
    <p class="st-help">Community names are what players say in comms. Game names are the ones in the game's own text. Typed answers accept the names that are shown.</p>
  </section>
</div>
