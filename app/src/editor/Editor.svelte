<script lang="ts">
  import './editor.css';
  import {
    addZone, checkDoc, createCallout, deleteCallout, exportDoc, loadDoc, moveAnchor, moveZone, neighbourSuggestions, paintAreas, regenerate, removeZone, renameZone, setNeighbour, setPlan,
    setPolygon, updateCallout, type EditorDoc, type Patch, type PlannedShot,
  } from '../core/editor/doc';
  import { History } from '../core/editor/history';
  import { buildNavIndex, floodFill, areaAt, type NavIndex } from '../core/editor/nav';
  import { EYE, proposeShots, regionsInCone, yawTo } from '../core/editor/shotplan';
  import type { Point } from '../core/geometry';
  import { shapesFor, type ViewBox } from '../core/mapview';
  import { worldToPixel } from '../core/projection';
  import type { Callout } from '../core/schema';
  import CalloutForm from './CalloutForm.svelte';
  import CalloutList from './CalloutList.svelte';
  import CheckPanel from './CheckPanel.svelte';
  import { ConflictError, loadMap, loadNav, radarUrl, saveMap } from './client';
  import EditorCanvas, { type CanvasShot, type Label, type Layer, type Outline, type Tool } from './EditorCanvas.svelte';
  import ShotsPanel from './ShotsPanel.svelte';
  import ZonesPanel from './ZonesPanel.svelte';

  let { mapId }: { mapId: string } = $props();

  type Tab = 'callouts' | 'details' | 'shots' | 'zones' | 'check';
  const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click a region to select its callout.' },
    { id: 'brush', label: 'Paint', key: 'b', hint: 'Drag to paint nav areas into the selected callout.' },
    { id: 'erase', label: 'Erase', key: 'e', hint: 'Drag to take nav areas out of the selected callout.' },
    { id: 'fill', label: 'Fill', key: 'f', hint: 'Click an area to fill everything connected to it, out to the fill radius.' },
    { id: 'polygon', label: 'Polygon', key: 'p', hint: 'Click corners; click the first corner or press Enter to close. Esc cancels.' },
    { id: 'anchor', label: 'Label', key: 'a', hint: "Click to move the selected callout's label point (it must stay inside the region)." },
    { id: 'shot', label: 'Camera', key: 'c', hint: 'Click to place a planned shot looking at the label. Drag a marker to move it, its ring to turn it.' },
  ];

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const zoneColor = (i: number) => `hsl(${(28 + i * 53) % 360} 36% 36%)`;

  // ---- loading ----
  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let failure = $state('');
  let doc = $state.raw<EditorDoc | null>(null);
  let savedDoc = $state.raw<EditorDoc | null>(null);
  let nav = $state.raw<NavIndex | null>(null);
  let radars = $state.raw<string[]>([]);
  let notices = $state.raw<string[]>([]);
  let etag = '';
  let history: History<EditorDoc> | null = null;
  let generation = 0;

  async function load(id: string) {
    const mine = ++generation;
    phase = 'loading';
    try {
      const loaded = await loadMap(id);
      if (!loaded.hasNav) throw new Error(`There is no nav mesh for ${id}. It belongs at assets/valve/nav/${id}.json (content-tools/spike/nav_export.py writes it).`);
      const mesh = await loadNav(id);
      if (mine !== generation) return;
      const opened = loadDoc(loaded.map, loaded.callouts, loaded.work);
      nav = buildNavIndex(mesh, loaded.map.levels);
      history = new History(opened.doc);
      doc = opened.doc;
      savedDoc = opened.doc;
      etag = loaded.etag;
      radars = loaded.radars;
      notices = opened.notices;
      level = loaded.map.levels[0]?.id ?? 'default';
      selected = null;
      phase = 'ready';
    } catch (e) {
      if (mine !== generation) return;
      failure = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  $effect(() => {
    void load(mapId);
    return () => {
      generation += 1;
    };
  });

  // ---- what is being done ----
  let tool = $state<Tool>('select');
  let tab = $state<Tab>('callouts');
  let selected = $state<string | null>(null);
  let level = $state('default');
  let brush = $state(60);
  let fillRadius = $state(500);
  let steal = $state(true);
  let showRadar = $state(true);
  let showNav = $state(true);
  let showLabels = $state(true);
  let draft = $state.raw<Point[]>([]);
  let dropped = $state.raw<Record<string, number>>({});
  let toast = $state('');
  let neighbourError = $state<string | null>(null);
  let zoneError = $state<string | null>(null);
  let saving = $state(false);
  let saveMessage = $state('');
  let conflict = $state(false);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(text: string) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 4500);
  }

  // ---- derived from the document ----
  const dirty = $derived(doc !== savedDoc);
  // history is a plain object, so what it can do is read again whenever the document changes
  const canUndo = $derived.by(() => {
    void doc;
    return history?.canUndo ?? false;
  });
  const canRedo = $derived.by(() => {
    void doc;
    return history?.canRedo ?? false;
  });
  const map = $derived(doc?.map ?? null);
  const proj = $derived(doc?.map.projection ?? { posX: 0, posY: 0, scale: 1 });
  const radarSize = $derived(doc?.map.radarSize ?? 1024);
  const current = $derived(doc && selected ? (doc.callouts.find((c) => c.id === selected) ?? null) : null);

  const areaPaths = $derived.by(() => {
    if (!nav) return [];
    const r = (n: number) => Math.round(n * 10) / 10;
    return nav.areas.map((a) => `M${a.outline.map((p) => worldToPixel(proj, p[0], p[1])).map(([x, y]) => `${r(x)} ${r(y)}`).join('L')}Z`);
  });

  const fit = $derived.by((): ViewBox => {
    if (!nav) return { x: 0, y: 0, w: 1024, h: 1024 };
    const b = nav.bounds;
    const [x0, y0] = worldToPixel(proj, b.minX, b.maxY);
    const [x1, y1] = worldToPixel(proj, b.maxX, b.minY);
    const m = Math.max(x1 - x0, y1 - y0) * 0.04;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  });

  const painted = $derived.by(() => {
    const layers: Layer[] = [];
    const owned = new Set<number>();
    const current = doc;
    if (!current || !nav) return { layers, unassigned: '', owned };
    const zoneIndex = (z: string) => Math.max(0, current.map.zones.findIndex((x) => x.id === z));
    for (const c of current.callouts) {
      const ids = current.paint[c.id];
      if (!ids || ids.length === 0) continue;
      let d = '';
      for (const a of ids) {
        if (nav.areas[a]?.level !== level) continue;
        d += areaPaths[a];
        if (c.tier !== 3) owned.add(a);
      }
      if (d !== '') layers.push({ id: c.id, d, color: c.tier === 3 ? 'var(--text)' : zoneColor(zoneIndex(c.zone)), hard: c.tier === 3 });
    }
    layers.sort((p, q) => Number(p.hard) - Number(q.hard));
    let unassigned = '';
    for (const a of nav.areas) if (a.level === level && !owned.has(a.id)) unassigned += areaPaths[a.id];
    return { layers, unassigned, owned };
  });
  const selectedPath = $derived(painted.layers.find((l) => l.id === selected)?.d ?? '');

  const placed = $derived(doc ? doc.callouts.filter((c) => c.region.length >= 3 && c.level === level) : []);
  const shapes = $derived(shapesFor(placed, proj));
  const outlines = $derived<Outline[]>(shapes.map((s) => ({ id: s.id, d: s.d, selected: s.id === selected, hard: s.tier === 3 })));
  const labels = $derived<Label[]>(shapes.map((s) => ({ id: s.id, text: s.name, at: s.anchor, selected: s.id === selected })));
  const regions = $derived(placed.map((c) => ({ id: c.id, polygon: c.region as Point[] })));

  const exported = $derived(doc ? exportDoc(doc) : null);
  const issues = $derived(doc ? checkDoc(doc) : []);
  const unfinished = $derived(new Set(exported?.unfinished.map((u) => u.id) ?? []));
  const broken = $derived(new Set(issues.filter((i) => i.severity === 'error' && i.callout).map((i) => i.callout as string)));
  const errorCount = $derived(issues.filter((i) => i.severity === 'error').length);

  const suggestions = $derived(current && doc && nav ? neighbourSuggestions(doc, current.id, nav) : []);
  const parents = $derived(doc ? doc.callouts.filter((c) => c.tier !== 3 && c.id !== selected) : []);
  const planned = $derived(current && doc ? (doc.plan[current.id] ?? []) : []);
  const canvasShots = $derived.by((): CanvasShot[] => {
    if (!current) return [];
    return [
      ...current.shots.map((s, i): CanvasShot => ({ index: i, at: [s.pos[0], s.pos[1]], yaw: s.yaw, planned: false })),
      ...planned.map((s, i): CanvasShot => ({ index: i, at: [s.pos[0], s.pos[1]], yaw: s.yaw, planned: true })),
    ];
  });
  const sees = $derived(planned.map((s) => regionsInCone([s.pos[0], s.pos[1]], s.yaw, regions).map((id) => doc?.callouts.find((c) => c.id === id)?.name ?? id)));
  const hint = $derived(!selected && tool !== 'select' && tool !== 'polygon' ? 'Pick or add a callout first.' : (TOOLS.find((t) => t.id === tool)?.hint ?? ''));

  const nameOf = (id: string) => doc?.callouts.find((c) => c.id === id)?.name ?? id;
  const areaCount = (id: string) => doc?.paint[id]?.length ?? 0;
  const radarFor = $derived.by(() => {
    if (!doc) return null;
    const i = doc.map.levels.findIndex((l) => l.id === level);
    const name = i <= 0 ? mapId : `${mapId}_${level}`;
    return radars.includes(name) ? radarUrl(name) : null;
  });

  // ---- changing the document ----
  function commit(next: EditorDoc) {
    if (history) doc = history.commit(next);
  }
  function remember(rg: { doc: EditorDoc; dropped: Record<string, number> }) {
    dropped = { ...dropped, ...rg.dropped };
    commit(rg.doc);
  }

  function setTool(next: Tool) {
    if (tool === 'polygon' && next !== 'polygon') draft = [];
    tool = next;
  }

  function choose(id: string) {
    selected = id;
    tab = 'details';
    neighbourError = null;
  }

  function create(name: string, zone: string, tier: 1 | 2 | 3) {
    if (!doc) return;
    const made = createCallout(doc, name, { zone, tier, level });
    commit(made.doc);
    selected = made.id;
    tab = 'details';
    tool = 'brush';
  }

  function patch(p: Patch) {
    if (doc && selected) commit(updateCallout(doc, selected, p));
  }

  function neighbour(id: string, on: boolean) {
    if (!doc || !selected) return;
    const r = setNeighbour(doc, selected, id, on);
    neighbourError = r.error;
    if (!r.error) commit(r.doc);
  }

  function removeSelected() {
    if (!doc || !selected) return;
    commit(deleteCallout(doc, selected));
    selected = null;
    tab = 'callouts';
  }

  function clearRegion() {
    if (!doc || !selected) return;
    const painted = paintAreas(doc, selected, doc.paint[selected] ?? [], 'remove').doc;
    const without = { ...painted, callouts: painted.callouts.map((c) => (c.id === selected ? { ...c, region: [] } : c)) };
    const { [selected]: _gone, ...paint } = without.paint;
    void _gone;
    commit({ ...without, paint });
  }

  // painting
  let strokeOk = false;
  let touched = new Set<string>();
  function onstroke(phase: 'start' | 'move' | 'end', areas: number[]) {
    if (!history || !nav) return;
    if (phase === 'start') {
      strokeOk = selected !== null && !!doc?.callouts.some((c) => c.id === selected);
      if (!strokeOk) return flash('Pick or add a callout first, then paint.');
      touched = new Set();
      history.begin();
      return;
    }
    if (!strokeOk || !selected) return;
    if (phase === 'move') {
      const r = paintAreas(history.present, selected, areas, tool === 'erase' ? 'remove' : 'add', { steal });
      r.touched.forEach((t) => touched.add(t));
      doc = history.replace(r.doc);
    } else {
      const rg = regenerate(history.present, nav, [...touched]);
      history.replace(rg.doc);
      dropped = { ...dropped, ...rg.dropped };
      doc = history.end();
      strokeOk = false;
    }
  }

  function onfill(seed: number) {
    if (!doc || !nav || !selected) return flash('Pick or add a callout first, then fill.');
    const me = doc.callouts.find((c) => c.id === selected);
    if (!me) return;
    const blocked = new Set<number>();
    if (!steal) for (const c of doc.callouts) if (c.id !== selected && (c.tier === 3) === (me.tier === 3)) for (const a of doc.paint[c.id] ?? []) blocked.add(a);
    const ids = floodFill(nav, seed, { level, radius: fillRadius, blocked });
    const r = paintAreas(doc, selected, ids, 'add', { steal });
    remember(regenerate(r.doc, nav, r.touched));
  }

  function onselect(id: string | null) {
    selected = id;
    if (id) tab = 'details';
  }

  function onvertex(at: Point) {
    if (!selected) return flash('Pick or add a callout first, then draw.');
    draft = [...draft, at];
  }
  function onfinish() {
    if (doc && selected && draft.length >= 3) commit(setPolygon(doc, selected, draft));
    else if (draft.length > 0) flash('A region needs at least three corners.');
    draft = [];
  }
  function onanchor(at: Point) {
    if (doc && selected) commit(moveAnchor(doc, selected, at));
  }

  // shots
  const planOf = (): readonly PlannedShot[] => (doc && selected ? (doc.plan[selected] ?? []) : []);
  function eyeAt(p: Point, fallback = EYE): number {
    const a = nav ? areaAt(nav, p[0], p[1], level) : null;
    return a !== null && nav ? round1((nav.areas[a]?.z ?? 0) + EYE) : fallback;
  }
  function onshotadd(at: Point) {
    if (!doc || !selected || !current) return flash('Pick or add a callout first.');
    const used = new Set(planOf().map((s) => s.kind));
    const kind = (['approach', 'alternate', 'inside', 'overview'] as const).find((k) => !used.has(k)) ?? 'approach';
    commit(setPlan(doc, selected, [...planOf(), { pos: [round1(at[0]), round1(at[1]), eyeAt(at)], yaw: yawTo(at, current.anchor), pitch: 0, stance: 'stand', kind }]));
  }
  function setShot(index: number, next: PlannedShot, live: boolean) {
    if (!doc || !selected || !history) return;
    const list = planOf().map((s, i) => (i === index ? next : s));
    const updated = setPlan(history.present, selected, list);
    doc = live ? history.replace(updated) : history.commit(updated);
  }
  function onshotmove(index: number, at: Point) {
    const s = planOf()[index];
    if (s) setShot(index, { ...s, pos: [round1(at[0]), round1(at[1]), eyeAt(at, s.pos[2])] }, true);
  }
  function onshotaim(index: number, yaw: number) {
    const s = planOf()[index];
    if (s) setShot(index, { ...s, yaw }, true);
  }
  function ondrag(phase: 'start' | 'end') {
    if (!history) return;
    if (phase === 'start') history.begin();
    else doc = history.end();
  }
  function proposeForSelected() {
    if (!doc || !nav || !current) return;
    const shots = proposeShots(current, doc, { callouts: doc.callouts, nav });
    if (shots.length === 0) return flash('Nothing could be proposed: no reachable floor around the label.');
    commit(setPlan(doc, current.id, shots));
  }
  function aimAtLabel(index: number) {
    const s = planOf()[index];
    if (s && current) setShot(index, { ...s, yaw: yawTo([s.pos[0], s.pos[1]], current.anchor) }, false);
  }
  function removeShot(index: number) {
    if (doc && selected) commit(setPlan(doc, selected, planOf().filter((_, i) => i !== index)));
  }

  // zones
  function zoneAction(r: { doc: EditorDoc; error?: string | null }) {
    zoneError = r.error ?? null;
    if (!r.error) commit(r.doc);
  }

  // undo, redo, save
  function undo() {
    if (history?.canUndo) doc = history.undo();
  }
  function redo() {
    if (history?.canRedo) doc = history.redo();
  }
  async function save() {
    if (!doc || saving) return;
    const snapshot = doc;
    saving = true;
    saveMessage = '';
    try {
      etag = await saveMap(mapId, etag, snapshot);
      savedDoc = snapshot;
      conflict = false;
      saveMessage = `Saved ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      if (e instanceof ConflictError) {
        conflict = true;
        saveMessage = 'The files changed on disk after this page loaded them.';
      } else saveMessage = e instanceof Error ? e.message : 'Saving failed';
    } finally {
      saving = false;
    }
  }

  function onkey(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') {
      draft = [];
      return;
    }
    if (e.key === 'Enter' && tool === 'polygon') {
      onfinish();
      return;
    }
    if (e.key === '[') brush = Math.max(8, Math.round(brush / 1.25));
    else if (e.key === ']') brush = Math.min(400, Math.round(brush * 1.25));
    else {
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    }
  }

  $effect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });
</script>

<svelte:window onkeydown={onkey} />

{#if phase !== 'ready' || !doc || !nav || !map}
  <div class="app" style:grid-template-rows="var(--bar-h) minmax(0, 1fr)">
    <header class="bar"><span class="brand">callouts</span><span class="crumb"><b>editor</b> · {mapId}</span></header>
    <main class="ed-home">
      {#if phase === 'loading'}
        <p>Loading {mapId}…</p>
      {:else}
        <h1>Could not open {mapId}</h1>
        <p class="sub">{failure}</p>
        <p><a href="#/editor">Back to the maps</a></p>
      {/if}
    </main>
  </div>
{:else}
  <div class="ed">
    <header class="ed-bar">
      <span class="brand">callouts</span>
      <a class="sub" href="#/editor">editor</a>
      <b>{map.displayName}</b>
      <span class="sep"></span>
      <div class="ed-group" role="toolbar" aria-label="Tools">
        {#each TOOLS as t (t.id)}
          <button class="ed-tool" type="button" aria-pressed={tool === t.id} title={t.hint} onclick={() => setTool(t.id)}>{t.label}<kbd>{t.key}</kbd></button>
        {/each}
      </div>
      <span class="sep"></span>
      <div class="ed-group">
        <label>brush <input type="range" min="8" max="400" step="1" bind:value={brush} aria-label="Brush radius" /> <span class="nums">{brush}</span></label>
        <label>fill <input type="range" min="100" max="3000" step="50" bind:value={fillRadius} aria-label="Fill radius" /> <span class="nums">{fillRadius}</span></label>
        <label><input type="checkbox" bind:checked={steal} /> overwrite others</label>
      </div>
      <span class="sep"></span>
      <div class="ed-group">
        <label><input type="checkbox" bind:checked={showRadar} disabled={!radarFor} /> radar</label>
        <label><input type="checkbox" bind:checked={showNav} /> mesh</label>
        <label><input type="checkbox" bind:checked={showLabels} /> labels</label>
        {#if map.levels.length > 1}
          <span class="tabs" role="tablist" aria-label="Level">
            {#each map.levels as l (l.id)}<button class="tab" type="button" role="tab" aria-selected={l.id === level} onclick={() => (level = l.id)}>{l.id}</button>{/each}
          </span>
        {/if}
      </div>
      <span class="sep"></span>
      <div class="ed-group">
        <button class="btn" type="button" disabled={!canUndo} onclick={undo}>Undo</button>
        <button class="btn" type="button" disabled={!canRedo} onclick={redo}>Redo</button>
      </div>
      <div class="ed-status">
        {#if saveMessage}<span class:bad={conflict || !saveMessage.startsWith('Saved')} class:ok={saveMessage.startsWith('Saved')}>{saveMessage}</span>{/if}
        {#if conflict}<button class="btn" type="button" onclick={() => location.reload()}>Reload</button>{/if}
        <span class:bad={dirty}>{dirty ? 'unsaved changes' : 'all saved'}</span>
        <button class="btn primary" type="button" disabled={saving || !dirty} onclick={save}>{saving ? 'Saving…' : 'Save'} <kbd>ctrl+s</kbd></button>
      </div>
    </header>

    <div class="ed-stage">
      <EditorCanvas
        index={nav}
        {proj}
        {radarSize}
        radar={showRadar ? radarFor : null}
        {level}
        {fit}
        {areaPaths}
        layers={painted.layers}
        unassigned={painted.unassigned}
        {selectedPath}
        {outlines}
        {labels}
        {regions}
        {tool}
        {brush}
        {showRadar}
        {showNav}
        {showLabels}
        {draft}
        anchor={current && current.region.length >= 3 ? current.anchor : null}
        shots={canvasShots}
        {onstroke}
        {onfill}
        {onselect}
        {onvertex}
        {onfinish}
        {onanchor}
        {onshotadd}
        {onshotmove}
        {onshotaim}
        {ondrag}
      />
      <div class="ed-hint">{hint} Wheel zooms; space-drag or middle-drag pans.</div>
      {#if toast || notices.length > 0}
        <div class="ed-notice" role="status">
          {#if toast}<span>{toast}</span>{/if}
          {#each notices as n (n)}<span>{n}</span>{/each}
          {#if notices.length > 0}<button class="btn" type="button" onclick={() => (notices = [])}>Dismiss</button>{/if}
        </div>
      {/if}
    </div>

    <aside class="ed-side">
      <div class="ed-tabs" role="tablist">
        <button class="tab" type="button" role="tab" aria-selected={tab === 'callouts'} onclick={() => (tab = 'callouts')}>Callouts<span class="count">{doc.callouts.length}</span></button>
        <button class="tab" type="button" role="tab" aria-selected={tab === 'details'} onclick={() => (tab = 'details')}>Details</button>
        <button class="tab" type="button" role="tab" aria-selected={tab === 'shots'} onclick={() => (tab = 'shots')}>Shots</button>
        <button class="tab" type="button" role="tab" aria-selected={tab === 'zones'} onclick={() => (tab = 'zones')}>Zones</button>
        <button class="tab" type="button" role="tab" aria-selected={tab === 'check'} onclick={() => (tab = 'check')}>Check<span class="count" class:bad={errorCount > 0}>{errorCount > 0 ? errorCount : issues.length}</span></button>
      </div>
      {#if tab === 'callouts'}
        <CalloutList callouts={doc.callouts} zones={map.zones} {selected} {unfinished} {broken} {areaCount} onselect={choose} oncreate={create} />
      {:else if tab === 'zones'}
        <ZonesPanel
          zones={map.zones}
          count={(z) => doc?.callouts.filter((c) => c.zone === z).length ?? 0}
          error={zoneError}
          onadd={(name) => doc && zoneAction({ doc: addZone(doc, name).doc })}
          onrename={(id, name) => doc && zoneAction({ doc: renameZone(doc, id, name) })}
          onmove={(id, by) => doc && zoneAction({ doc: moveZone(doc, id, by) })}
          onremove={(id) => doc && zoneAction(removeZone(doc, id))}
        />
      {:else if tab === 'check'}
        <CheckPanel {issues} {nameOf} onselect={choose} />
      {:else if !current}
        <div class="ed-panel"><p class="ed-empty">Select a callout in the list, or click a region on the map.</p></div>
      {:else if tab === 'details'}
        <CalloutForm
          callout={current}
          {map}
          {parents}
          all={doc.callouts}
          {suggestions}
          areas={areaCount(current.id)}
          dropped={dropped[current.id] ?? 0}
          unfinishedReasons={exported?.unfinished.find((u) => u.id === current.id)?.reasons ?? []}
          error={neighbourError}
          onpatch={patch}
          onneighbour={neighbour}
          onclear={clearRegion}
          ondelete={removeSelected}
          ontool={(t) => setTool(t)}
        />
      {:else}
        <ShotsPanel
          callout={current}
          {planned}
          {sees}
          onpropose={proposeForSelected}
          onchange={(i, s) => setShot(i, s, false)}
          onremove={removeShot}
          onaim={aimAtLabel}
          ontool={() => setTool('shot')}
        />
      {/if}
    </aside>
  </div>
{/if}
