<script lang="ts">
  let { map }: { map: string } = $props();
</script>

<!-- A stand-in so the route works; the work package that owns this screen replaces the file. -->
<div class="app stub">
  <header class="bar"><span class="brand">callouts</span></header>
  <main class="stub-body"><p class="sub">Summary screen. Not built yet. ({map})</p></main>
</div>

<style>
  .stub {
    grid-template-rows: var(--bar-h) minmax(0, 1fr);
  }
  .stub-body {
    padding: var(--s4);
  }
</style>
