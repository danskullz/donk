<script lang="ts">
  import { KEYMAP } from '../../app/keymap';

  // Two columns: the session alone, then the map and settings. On a phone the columns stack into one list.
  const columns = [KEYMAP.slice(0, 1), KEYMAP.slice(1)];
</script>

<div class="st-panel">
  {#each columns as column, i (i)}
    <div class="st-col">
      {#each column as group (group.id)}
        <section class="st-block">
          <h2>{group.title}</h2>
          <ul class="st-keys">
            {#each group.rows as row (row.does)}
              <li>
                <span class="st-keys-keys">{#each row.keys as k (k)}<kbd>{k}</kbd>{' '}{/each}</span>
                <span>{row.does}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/each}
</div>
