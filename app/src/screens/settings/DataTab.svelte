<script lang="ts">
  // Export, import, reset and offline (SCOPE.md §5.8, §5.6, §7.6), in three parts so no part scrolls. The file work is
  // in core/exportfile.ts (pure), the database work in storage/idb-store.ts, the pictures in app/packs.ts; this file is
  // the screen and the sentences.

  import { loadAvailableMaps } from '../../app/data';
  import {
    cacheMapPack,
    formatBytes,
    packStatus,
    packTargets,
    removeMapPack,
    storageReport,
    workerState,
    type PackStatus,
    type PackTarget,
    type StorageReport,
    type WorkerState,
  } from '../../app/packs';
  import { getSettings, settingsFromBackup, updateSettings, type AppSettings } from '../../app/settings';
  import {
    buildExport,
    calloutPrefix,
    countEventsForMap,
    exportFileName,
    MAX_IMPORT_BYTES,
    mergeEvents,
    parseImport,
    serializeExport,
    type MergeResult,
  } from '../../core/exportfile';
  import type { ReviewEvent } from '../../core/log';
  import { addEventsIfNew, deleteEventsForMap, logDbName, readEvents } from '../../storage/idb-store';
  import { PARTS, type ConfirmSpec, type PartId } from './nav';
  import Segmented from './Segmented.svelte';
  import Switch from './Switch.svelte';

  interface Props {
    part: PartId;
    onpart: (part: PartId) => void;
    ask: (spec: ConfirmSpec) => void;
    /** The database export and import work on (the real log, or the synthetic map's in development and e2e builds). */
    log: { name: string; demo: boolean };
  }
  let { part, onpart, ask, log }: Props = $props();

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = PARTS.map((p) => ({ value: p, label: p }));
  const when = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  // ---- backup: export and import ----
  interface Preview {
    fileName: string;
    exportedAt: string | null;
    merge: MergeResult;
    invalid: number;
    /** Valid rows that repeat an id earlier in the same file, counted with the ones already here. */
    repeated: number;
    settings: { patch: Partial<AppSettings>; rejected: string[] } | null;
  }

  let total = $state<number | null>(null);
  let unreadable = $state(0);
  let exportNote = $state('');
  let preview = $state.raw<Preview | null>(null);
  let importError = $state('');
  let importNote = $state('');
  let useSettings = $state(false);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  async function refreshTotal() {
    try {
      const l = await readEvents(log.name);
      total = l.events.length;
      unreadable = l.invalid;
    } catch {
      total = null;
    }
  }

  async function doExport() {
    busy = true;
    exportNote = '';
    try {
      const { events, invalid } = await readEvents(log.name);
      const now = Date.now();
      const name = exportFileName(now);
      const url = URL.createObjectURL(new Blob([serializeExport(buildExport(events, getSettings(), now))], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      exportNote = `Downloaded ${plural(events.length, 'event')} as ${name}.${invalid > 0 ? ` ${plural(invalid, 'unreadable row')} left out.` : ''}`;
    } catch (e) {
      exportNote = `The export failed: ${e instanceof Error ? e.message : 'unknown error'}.`;
    } finally {
      busy = false;
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so the same file can be picked again
    if (!file) return;
    importError = '';
    importNote = '';
    preview = null;
    if (file.size > MAX_IMPORT_BYTES) {
      importError = `That file is ${formatBytes(file.size)}, far more than a backup holds.`;
      return;
    }
    busy = true;
    try {
      const parsed = parseImport(await file.text());
      if (!parsed.ok) {
        importError = parsed.message;
        return;
      }
      const merge = mergeEvents((await readEvents(log.name)).events, parsed.events);
      const settings = parsed.settings ? settingsFromBackup(parsed.settings) : null;
      preview = { fileName: file.name, exportedAt: parsed.exportedAt, merge, invalid: parsed.invalid, repeated: parsed.repeated, settings };
      useSettings = false;
    } catch (err) {
      importError = `That file could not be read: ${err instanceof Error ? err.message : 'unknown error'}.`;
    } finally {
      busy = false;
    }
  }

  async function doMerge() {
    const p = preview;
    if (!p) return;
    busy = true;
    try {
      const written = await addEventsIfNew(p.merge.added, log.name);
      const took = useSettings && p.settings && Object.keys(p.settings.patch).length > 0;
      if (took && p.settings) updateSettings(p.settings.patch);
      importNote = `Added ${plural(written, 'event')}${took ? ' and the settings from the file' : ''}. Everything else was already here.`;
      preview = null;
      await Promise.all([refreshTotal(), loadRows()]);
    } catch (err) {
      importError = `The events could not be saved: ${err instanceof Error ? err.message : 'unknown error'}. Nothing was changed.`;
    } finally {
      busy = false;
    }
  }

  function cancelImport() {
    preview = null;
    importError = '';
  }

  // ---- progress: reset one map ----
  interface MapRow {
    id: string;
    name: string;
    demo: boolean;
    count: number;
  }
  const PER_PAGE = 3;
  let rows = $state.raw<MapRow[]>([]);
  let rowPage = $state(0);
  let resetNote = $state('');

  async function loadRows() {
    try {
      const maps = await loadAvailableMaps();
      const logs = new Map<string, ReviewEvent[]>();
      for (const name of new Set(maps.map((m) => logDbName(m.demo)))) logs.set(name, (await readEvents(name)).events);
      rows = maps.map((m) => ({
        id: m.map.id,
        name: m.demo ? `${m.map.displayName} (development)` : m.map.displayName,
        demo: m.demo,
        count: countEventsForMap(logs.get(logDbName(m.demo)) ?? [], m.map.id),
      }));
    } catch {
      rows = [];
    }
  }

  function askReset(row: MapRow) {
    ask({
      title: `Reset progress for ${row.name}?`,
      body: `This deletes ${plural(row.count, 'recorded event')} (answers and intro cards) for ${row.name} from this browser. Other maps and your settings stay. It cannot be undone, so export a backup first if you might want them back.`,
      action: `Delete ${row.name} progress`,
      cancel: 'Keep it',
      run: async () => {
        try {
          const removed = await deleteEventsForMap(calloutPrefix(row.id), logDbName(row.demo));
          resetNote = `Deleted ${plural(removed, 'event')} for ${row.name}.`;
        } catch (err) {
          resetNote = `Could not reset ${row.name}: ${err instanceof Error ? err.message : 'unknown error'}.`;
        }
        await Promise.all([refreshTotal(), loadRows()]);
      },
    });
  }

  // ---- offline: the worker and the packs ----
  const PACKS_PER_PAGE = 2;
  let worker = $state<WorkerState | null>(null);
  let storage = $state<StorageReport | null>(null);
  let targets = $state.raw<PackTarget[]>([]);
  let statuses = $state.raw<Record<string, PackStatus>>({});
  let packPage = $state(0);
  let packNote = $state('');
  let running = $state<{ id: string; done: number; total: number; bytes: number; stop: AbortController } | null>(null);

  async function loadOffline() {
    [worker, storage] = await Promise.all([workerState(), storageReport()]);
    targets = await packTargets();
    const next: Record<string, PackStatus> = {};
    for (const t of targets) next[t.mapId] = await packStatus(t.mapId);
    statuses = next;
  }

  async function download(t: PackTarget, refresh: boolean) {
    const stop = new AbortController();
    running = { id: t.mapId, done: 0, total: t.urls.length, bytes: 0, stop };
    packNote = '';
    try {
      const after = await cacheMapPack(t.mapId, {
        refresh,
        signal: stop.signal,
        onProgress: (p) => {
          if (running) running = { ...running, done: p.done, total: p.total, bytes: p.bytes };
        },
      });
      if (after.state === 'partial') packNote = `${t.name}: ${after.cached} of ${after.total} pictures saved. Press Finish download to try the rest again.`;
    } catch (err) {
      packNote = `${t.name}: ${err instanceof Error ? err.message : 'the download failed'}.`;
    } finally {
      running = null;
      statuses = { ...statuses, [t.mapId]: await packStatus(t.mapId) };
      storage = await storageReport();
    }
  }

  async function remove(t: PackTarget) {
    await removeMapPack(t.mapId);
    packNote = '';
    statuses = { ...statuses, [t.mapId]: await packStatus(t.mapId) };
    storage = await storageReport();
  }

  function describe(s: PackStatus | undefined): string {
    if (!s) return 'checking';
    switch (s.state) {
      case 'empty':
        return 'no pictures yet';
      case 'inline':
        return 'pictures are built in, nothing to download';
      case 'none':
        return `${plural(s.total, 'picture')}, not downloaded`;
      case 'partial':
        return `${s.cached} of ${plural(s.total, 'picture')} saved${s.bytes > 0 ? `, ${formatBytes(s.bytes)}` : ''}`;
      case 'ready':
        return `${plural(s.total, 'picture')}, ${s.bytes > 0 ? formatBytes(s.bytes) : 'size unknown'}${s.updatedAt ? `, saved ${when(s.updatedAt)}` : ''}`;
    }
  }

  const WORKER_TEXT: Record<WorkerState, string> = {
    ready: 'Works offline: yes. The app is saved on this device.',
    installing: 'Works offline: not yet. Reload once while online and it will be.',
    development: 'Works offline: no, this is a development build. Only a production build is saved.',
    unavailable: 'Works offline: no. The browser needs https or localhost for it.',
  };

  // Each part loads what it shows when it opens, so counts are never older than the visit.
  $effect(() => {
    if (part === 'backup') void refreshTotal();
    else if (part === 'progress') void loadRows();
    else void loadOffline();
  });

  const pages = (count: number, per: number) => Math.max(1, Math.ceil(count / per));
  const shownRows = $derived(rows.slice(rowPage * PER_PAGE, rowPage * PER_PAGE + PER_PAGE));
  const shownPacks = $derived(targets.slice(packPage * PACKS_PER_PAGE, packPage * PACKS_PER_PAGE + PACKS_PER_PAGE));
  const previewHasSettings = $derived(preview?.settings !== null && preview?.settings !== undefined && Object.keys(preview.settings.patch).length > 0);
</script>

<div class="st-data">
  <Segmented label="Data section" options={parts} value={part} onchoose={(v) => onpart(v as PartId)} />

  {#if part === 'backup'}
    <div class="st-panel">
      <div class="st-col">
        <section class="st-block">
          <h2>Export</h2>
          <p class="st-help">One file with every answer you have given and your settings. Keep a copy somewhere safe.{#if log.demo} <span class="chip warn">development log</span>{/if}</p>
          <div class="st-actions">
            <button class="btn primary" type="button" disabled={busy} onclick={doExport}>Download backup</button>
            <span class="sub nums">{total === null ? '' : plural(total, 'event')}</span>
          </div>
          <p class="st-note" role="status">{exportNote}</p>
        </section>
      </div>

      <div class="st-col">
        <section class="st-block">
          <h2>Import</h2>
          {#if preview}
            <div class="st-preview" role="status">
              <p class="st-counts nums">
                <span><b>{plural(preview.merge.added.length, 'new event')}</b>,</span>
                <span>{preview.merge.alreadyHere + preview.repeated} already here,</span>
                <span>{preview.invalid} invalid</span>
              </p>
              <p class="sub st-help">{preview.fileName}{preview.exportedAt ? `, made ${when(Date.parse(preview.exportedAt))}` : ''}{preview.merge.conflicts > 0 ? `. ${plural(preview.merge.conflicts, 'event differs', 'events differ')} from yours; yours are kept` : ''}.</p>
              {#if previewHasSettings}
                <Switch label="Also use its settings" checked={useSettings} onchange={(on) => (useSettings = on)} />
              {/if}
              <div class="st-actions">
                <button class="btn primary" type="button" disabled={busy || preview.merge.added.length === 0} onclick={doMerge}>
                  {preview.merge.added.length === 0 ? 'Nothing new' : `Merge ${plural(preview.merge.added.length, 'event')}`}
                </button>
                <button class="btn" type="button" onclick={cancelImport}>Cancel</button>
              </div>
            </div>
          {:else}
            <p class="st-help">Merge a backup file into this browser. Nothing is overwritten, and events you already have are skipped, so it is safe to repeat.</p>
            <div class="st-actions">
              <button class="btn" type="button" disabled={busy} onclick={() => fileInput?.click()}>Choose a backup file</button>
              <input bind:this={fileInput} class="sr-only" type="file" accept=".json,application/json" tabindex="-1" aria-label="Backup file" onchange={onFile} />
            </div>
          {/if}
          {#if importError}<p class="st-note st-error" role="alert">{importError}</p>{/if}
          {#if importNote}<p class="st-note" role="status">{importNote}</p>{/if}
        </section>
      </div>
    </div>
  {:else if part === 'progress'}
    <div class="st-panel st-one">
      <section class="st-block">
        <h2>Reset progress for one map</h2>
        <p class="st-help">Deletes that map's answers and intro cards from this browser. Other maps and your settings stay.</p>
        <ul class="st-rows">
          {#each shownRows as row (row.id)}
            <li class="st-row">
              <span class="st-row-main"><b>{row.name}</b> <span class="sub nums">{plural(row.count, 'event')}</span></span>
              <button class="btn" type="button" disabled={row.count === 0} aria-label="Reset {row.name}" onclick={() => askReset(row)}>Reset…</button>
            </li>
          {/each}
        </ul>
        {#if rows.length > PER_PAGE}
          <div class="st-pager sub nums">
            <button class="btn" type="button" aria-label="Previous maps" disabled={rowPage === 0} onclick={() => rowPage--}>‹</button>
            <span>{rowPage + 1} / {pages(rows.length, PER_PAGE)}</span>
            <button class="btn" type="button" aria-label="Next maps" disabled={rowPage >= pages(rows.length, PER_PAGE) - 1} onclick={() => rowPage++}>›</button>
          </div>
        {/if}
        <p class="st-note" role="status">{resetNote}</p>
      </section>
    </div>
  {:else}
    <div class="st-panel">
      <div class="st-col">
        <section class="st-block">
          <h2>This device</h2>
          <p class="st-help st-worker" data-state={worker ?? 'checking'}>{worker ? WORKER_TEXT[worker] : 'Checking…'}</p>
          {#if storage}
            <p class="st-help nums">
              {#if storage.usage !== null && storage.quota !== null}Using {formatBytes(storage.usage)} of {formatBytes(storage.quota)}. {/if}
              {#if storage.persisted === true}The browser has promised not to clear it.{:else if storage.persisted === false}The browser may clear it if space runs low.{/if}
            </p>
          {/if}
        </section>
      </div>

      <div class="st-col">
        <section class="st-block">
          <h2>Map packs</h2>
          <p class="st-help">Pictures for offline study. The size is known once they are downloaded.</p>
          <ul class="st-rows">
            {#each shownPacks as t (t.mapId)}
              {@const s = statuses[t.mapId]}
              <li class="st-row st-pack" data-map={t.mapId}>
                <span class="st-row-main"><b>{t.name}</b> <span class="sub st-pack-status">{describe(s)}</span></span>
                {#if running?.id === t.mapId}
                  <span class="st-row-acts">
                    <span class="sub nums st-progress">{running.done} / {running.total}, {formatBytes(running.bytes)}</span>
                    <button class="btn" type="button" onclick={() => running?.stop.abort()}>Stop</button>
                  </span>
                {:else if s && s.state !== 'empty' && s.state !== 'inline'}
                  <span class="st-row-acts">
                    <button class="btn" class:primary={s.state === 'none'} type="button" disabled={running !== null} onclick={() => download(t, s.state === 'ready')}>
                      {s.state === 'none' ? 'Download for offline' : s.state === 'partial' ? 'Finish download' : 'Update'}
                    </button>
                    {#if s.state !== 'none'}<button class="btn" type="button" aria-label="Remove {t.name} pictures" disabled={running !== null} onclick={() => remove(t)}>Remove</button>{/if}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if targets.length > PACKS_PER_PAGE}
            <div class="st-pager sub nums">
              <button class="btn" type="button" aria-label="Previous maps" disabled={packPage === 0} onclick={() => packPage--}>‹</button>
              <span>{packPage + 1} / {pages(targets.length, PACKS_PER_PAGE)}</span>
              <button class="btn" type="button" aria-label="Next maps" disabled={packPage >= pages(targets.length, PACKS_PER_PAGE) - 1} onclick={() => packPage++}>›</button>
            </div>
          {/if}
          <p class="st-note" role="status">{packNote}</p>
        </section>
      </div>
    </div>
  {/if}
</div>
