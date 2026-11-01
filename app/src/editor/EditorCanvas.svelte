<script lang="ts" module>
  import type { Point } from '../core/geometry';

  export type Tool = 'select' | 'brush' | 'erase' | 'fill' | 'polygon' | 'anchor' | 'shot';

  /** Painted nav areas of one callout, as one path. */
  export interface Layer {
    id: string;
    d: string;
    color: string;
    hard: boolean;
  }
  export interface Outline {
    id: string;
    d: string;
    selected: boolean;
    hard: boolean;
  }
  export interface Label {
    id: string;
    text: string;
    at: Point;
    selected: boolean;
  }
  export interface CanvasShot {
    index: number;
    /** Where the camera is, in world units. Null for a shot that is only listed (captured). */
    at: Point;
    yaw: number;
    planned: boolean;
  }
</script>

<script lang="ts">
  import { areaAt, areasWithin, type NavIndex } from '../core/editor/nav';
  import { yawTo } from '../core/editor/shotplan';
  import { smallestRegionAt } from '../core/geometry';
  import { coneFor, panBy, zoomAt, type ViewBox } from '../core/mapview';
  import { pixelToWorld, worldToPixel, type Projection } from '../core/projection';

  interface Props {
    index: NavIndex;
    proj: Projection;
    radarSize: number;
    radar: string | null;
    level: string;
    fit: ViewBox;
    areaPaths: readonly string[];
    layers: readonly Layer[];
    unassigned: string;
    selectedPath: string;
    outlines: readonly Outline[];
    labels: readonly Label[];
    /** Region polygons in world units for the Select tool, on this level. */
    regions: readonly { id: string; polygon: readonly Point[] }[];
    tool: Tool;
    /** Brush radius in world units. */
    brush: number;
    showRadar: boolean;
    showNav: boolean;
    showLabels: boolean;
    draft: readonly Point[];
    anchor: Point | null;
    shots: readonly CanvasShot[];
    onstroke: (phase: 'start' | 'move' | 'end', areas: number[]) => void;
    onfill: (area: number) => void;
    onselect: (id: string | null) => void;
    onvertex: (at: Point) => void;
    onfinish: () => void;
    onanchor: (at: Point) => void;
    onshotadd: (at: Point) => void;
    onshotmove: (index: number, at: Point) => void;
    onshotaim: (index: number, yaw: number) => void;
    ondrag: (phase: 'start' | 'end') => void;
  }

  let {
    index, proj, radarSize, radar, level, fit, areaPaths, layers, unassigned, selectedPath, outlines, labels, regions, tool, brush, showRadar, showNav, showLabels, draft, anchor, shots,
    onstroke, onfill, onselect, onvertex, onfinish, onanchor, onshotadd, onshotmove, onshotaim, ondrag,
  }: Props = $props();

  /** The editor zooms in much further than the quiz maps: a brush a few units wide must be usable. */
  const MAX = 40;

  let view = $derived(fit);
  let svg = $state<SVGSVGElement>();
  let width = $state(1);
  let height = $state(1);
  let hover = $state<number | null>(null);
  let cursor = $state<Point | null>(null);
  let space = $state(false);
  let panning = $state(false);

  /** Radar pixels per screen pixel; things that must stay one size on screen are drawn at this scale. */
  const upp = $derived(Math.max(view.w / width, view.h / height));

  function toPixel(clientX: number, clientY: number): Point {
    const m = svg?.getScreenCTM();
    if (!svg || !m) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  function toWorld(clientX: number, clientY: number): Point {
    const [px, py] = toPixel(clientX, clientY);
    return pixelToWorld(proj, px, py);
  }

  let pan: { id: number; x: number; y: number; from: ViewBox } | null = null;
  let stroke: { id: number; seen: Set<number> } | null = null;
  let drag: { id: number; kind: 'move' | 'aim'; index: number } | null = null;

  function paintAt(w: Point) {
    if (!stroke) return;
    const fresh = areasWithin(index, w[0], w[1], brush, level).filter((a) => !stroke?.seen.has(a));
    if (fresh.length === 0) return;
    for (const a of fresh) stroke.seen.add(a);
    onstroke('move', fresh);
  }

  function down(e: PointerEvent) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space)) {
      e.preventDefault();
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view };
      panning = true;
      svg?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const handle = (e.target as Element).closest('[data-shot]');
    if (handle) {
      drag = { id: e.pointerId, kind: handle.getAttribute('data-kind') === 'aim' ? 'aim' : 'move', index: Number(handle.getAttribute('data-shot')) };
      svg?.setPointerCapture(e.pointerId);
      ondrag('start');
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (tool === 'brush' || tool === 'erase') {
      stroke = { id: e.pointerId, seen: new Set() };
      svg?.setPointerCapture(e.pointerId);
      onstroke('start', []);
      paintAt(w);
    } else if (tool === 'fill') {
      const a = areaAt(index, w[0], w[1], level);
      if (a !== null) onfill(a);
    } else if (tool === 'select') {
      onselect(smallestRegionAt(w, regions.map((r) => ({ id: r.id, polygon: r.polygon })))?.id ?? null);
    } else if (tool === 'polygon') {
      const first = draft[0];
      if (first && draft.length >= 3) {
        const [fx, fy] = worldToPixel(proj, first[0], first[1]);
        const [px, py] = toPixel(e.clientX, e.clientY);
        if (Math.hypot(fx - px, fy - py) <= 10 * upp) return onfinish();
      }
      onvertex(w);
    } else if (tool === 'anchor') onanchor(w);
    else if (tool === 'shot') onshotadd(w);
  }

  function move(e: PointerEvent) {
    const w = toWorld(e.clientX, e.clientY);
    cursor = w;
    hover = tool === 'brush' || tool === 'erase' || tool === 'fill' ? areaAt(index, w[0], w[1], level) : null;
    if (pan && e.pointerId === pan.id) {
      view = panBy(pan.from, fit, -(e.clientX - pan.x) * upp, -(e.clientY - pan.y) * upp, MAX);
    } else if (stroke && e.pointerId === stroke.id) paintAt(w);
    else if (drag && e.pointerId === drag.id) {
      if (drag.kind === 'move') onshotmove(drag.index, w);
      else {
        const shot = shots.find((s) => s.index === drag?.index);
        if (shot) onshotaim(drag.index, yawTo(shot.at, w));
      }
    }
  }

  function up(e: PointerEvent) {
    if (pan && e.pointerId === pan.id) {
      pan = null;
      panning = false;
    }
    if (stroke && e.pointerId === stroke.id) {
      stroke = null;
      onstroke('end', []);
    }
    if (drag && e.pointerId === drag.id) {
      drag = null;
      ondrag('end');
    }
  }

  function wheel(e: WheelEvent) {
    view = zoomAt(view, fit, toPixel(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0015), MAX);
  }

  function leave() {
    cursor = null;
    hover = null;
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) {
      space = true;
      e.preventDefault();
    }
  }
  const keyup = (e: KeyboardEvent) => {
    if (e.key === ' ') space = false;
  };

  const ringR = $derived(brush / proj.scale);
  const cursorPx = $derived(cursor ? worldToPixel(proj, cursor[0], cursor[1]) : null);
  const draftPx = $derived(draft.map((p) => worldToPixel(proj, p[0], p[1])));
  const anchorPx = $derived(anchor ? worldToPixel(proj, anchor[0], anchor[1]) : null);
  const coneLen = $derived(view.w * 0.07);
  const cones = $derived(
    shots.map((s) => {
      const cone = coneFor(proj, { pos: [s.at[0], s.at[1], 0], yaw: s.yaw }, { x: view.x, y: view.y, w: coneLen / 0.09, h: 0 });
      const rad = (s.yaw * Math.PI) / 180;
      // the handle sits on the cone's axis, so dragging it turns the camera
      const handle: Point = [cone.apex[0] + Math.cos(rad) * coneLen * 0.95, cone.apex[1] - Math.sin(rad) * coneLen * 0.95];
      return { ...s, cone, handle };
    }),
  );
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svg
  bind:this={svg}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class:panning
  class:grab={space}
  data-tool={tool}
  viewBox="{view.x} {view.y} {view.w} {view.h}"
  role="application"
  aria-label="Map editor canvas"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onpointerleave={leave}
  onwheel={wheel}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#if showRadar && radar}
    <image href={radar} x="0" y="0" width={radarSize} height={radarSize} opacity="0.5" preserveAspectRatio="none" />
  {/if}
  {#if showNav}<path class="unassigned" d={unassigned} />{/if}
  {#each layers as l (l.id)}
    <path class="layer" class:hard={l.hard} d={l.d} style:fill={l.color} data-layer={l.id} />
  {/each}
  {#if selectedPath}<path class="chosen-areas" d={selectedPath} />{/if}
  {#each outlines as o (o.id)}
    <path class="outline" class:selected={o.selected} class:hard={o.hard} d={o.d} />
  {/each}
  {#if showLabels}
    {#each labels as l (l.id)}
      <text class="lbl" class:sel={l.selected} x={l.at[0]} y={l.at[1]} font-size={(l.selected ? 13 : 11) * upp}>{l.text}</text>
    {/each}
  {/if}
  {#if hover !== null && areaPaths[hover]}<path class="hover" d={areaPaths[hover]} />{/if}
  {#if draftPx.length > 0}
    <polyline class="draft" points={draftPx.map((p) => p.join(',')).join(' ')} />
    {#each draftPx as p, i}<circle class="draft-dot" class:first={i === 0} cx={p[0]} cy={p[1]} r={(i === 0 ? 6 : 3.5) * upp} />{/each}
  {/if}
  {#if anchorPx}
    <circle class="anchor" cx={anchorPx[0]} cy={anchorPx[1]} r={5 * upp} />
    <path class="anchor" d="M{anchorPx[0] - 9 * upp} {anchorPx[1]}h{18 * upp}M{anchorPx[0]} {anchorPx[1] - 9 * upp}v{18 * upp}" />
  {/if}
  {#each cones as c (c.index + (c.planned ? 'p' : 'c'))}
    <path class="cone" class:planned={c.planned} d={c.cone.d} />
    {#if c.planned}
      <circle class="marker" data-shot={c.index} data-kind="move" cx={c.cone.apex[0]} cy={c.cone.apex[1]} r={6 * upp} />
      <circle class="aim" data-shot={c.index} data-kind="aim" cx={c.handle[0]} cy={c.handle[1]} r={5 * upp} />
      <text class="lbl" x={c.cone.apex[0]} y={c.cone.apex[1] - 10 * upp} font-size={10 * upp}>{c.index + 1}</text>
    {:else}
      <circle class="captured" cx={c.cone.apex[0]} cy={c.cone.apex[1]} r={4 * upp} />
    {/if}
  {/each}
  {#if cursorPx && (tool === 'brush' || tool === 'erase')}
    <circle class="ring" class:erase={tool === 'erase'} cx={cursorPx[0]} cy={cursorPx[1]} r={ringR} />
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  svg[data-tool='select'] {
    cursor: default;
  }
  svg.grab {
    cursor: grab;
  }
  svg.panning {
    cursor: grabbing;
  }
  path,
  polyline,
  circle {
    vector-effect: non-scaling-stroke;
  }
  .unassigned {
    fill: var(--m-new);
    fill-opacity: 0.55;
    stroke: var(--wall);
    stroke-width: 0.8;
    pointer-events: none;
  }
  .layer {
    fill-opacity: 0.78;
    stroke: var(--bg);
    stroke-width: 0.6;
    pointer-events: none;
  }
  .layer.hard {
    fill-opacity: 0.55;
  }
  .chosen-areas {
    fill: none;
    stroke: var(--main);
    stroke-width: 1.4;
    pointer-events: none;
  }
  .outline {
    fill: none;
    stroke: var(--text);
    stroke-opacity: 0.7;
    stroke-width: 1.2;
    pointer-events: none;
  }
  .outline.hard {
    stroke-dasharray: 5 3;
  }
  .outline.selected {
    stroke: var(--main);
    stroke-opacity: 1;
    stroke-width: 2.6;
  }
  .hover {
    fill: var(--text);
    fill-opacity: 0.18;
    stroke: var(--text);
    stroke-width: 1.4;
    pointer-events: none;
  }
  .ring {
    fill: var(--main);
    fill-opacity: 0.12;
    stroke: var(--main);
    stroke-width: 1.4;
    pointer-events: none;
  }
  .ring.erase {
    fill: var(--error);
    stroke: var(--error);
  }
  .draft {
    fill: var(--main);
    fill-opacity: 0.12;
    stroke: var(--main);
    stroke-width: 1.6;
    stroke-dasharray: 5 3;
    pointer-events: none;
  }
  .draft-dot {
    fill: var(--main);
    stroke: var(--bg);
    stroke-width: 1;
    pointer-events: none;
  }
  .draft-dot.first {
    fill: none;
    stroke: var(--main);
    stroke-width: 1.6;
  }
  .anchor {
    fill: none;
    stroke: var(--main);
    stroke-width: 2;
    pointer-events: none;
  }
  .cone {
    fill: var(--text);
    fill-opacity: 0.16;
    pointer-events: none;
  }
  .cone.planned {
    fill: var(--main);
    fill-opacity: 0.3;
  }
  .marker {
    fill: var(--main);
    stroke: var(--bg);
    stroke-width: 1.5;
    cursor: move;
  }
  .aim {
    fill: var(--bg);
    stroke: var(--main);
    stroke-width: 1.6;
    cursor: alias;
  }
  .captured {
    fill: var(--text);
    stroke: var(--bg);
    stroke-width: 1;
    pointer-events: none;
  }
  .lbl {
    font-family: var(--font);
    font-weight: 600;
    text-transform: lowercase;
    fill: var(--text);
    stroke: var(--bg);
    stroke-width: 3px;
    paint-order: stroke;
    stroke-linejoin: round;
    text-anchor: middle;
    pointer-events: none;
  }
  .lbl.sel {
    fill: var(--main);
  }
</style>
