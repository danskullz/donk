<script lang="ts" module>
  export interface Mark {
    id: string;
    text: string;
    tone: 'truth' | 'chosen';
  }
</script>

<script lang="ts">
  import type { Point } from '../core/geometry';
  import { MAX_ZOOM, panBy, zoomAt, zoomLevel, type ConeShape, type MapShape, type ViewBox } from '../core/mapview';
  import type { Mastery } from '../core/types';

  interface Props {
    shapes: readonly MapShape[];
    /** The view that shows everything: where the map starts, and the most it zooms out. */
    fit: ViewBox;
    /** Which floor is drawn. */
    level: string;
    label: string;
    /** Clicks pick a point, the wheel and the buttons zoom, dragging pans. */
    interactive?: boolean;
    /** Regions are focusable buttons named after their callout (Pin it and Where am I? have no other keyboard route). */
    names?: boolean;
    /** The right answer: filled in the accent. */
    truth?: string | null;
    /** The wrong pick: outlined as a miss. */
    chosen?: string | null;
    /** The zone hint: these regions are tinted and dashed. */
    lit?: ReadonlySet<string> | null;
    cone?: ConeShape | null;
    /** Where the learner clicked, in radar pixels. */
    guess?: Point | null;
    marks?: readonly Mark[];
    onpick?: (pixel: Point) => void;
    // ---- contract for the map package (work package A), accepted now so other screens can pass them ----
    /** Mastery state of each callout by id: the map as a progress bar (SCOPE §4.5). Not drawn yet. */
    fills?: Readonly<Record<string, Mastery>> | null;
    /** Callouts to emphasise, for example those that moved up in a session (the Summary screen). Not drawn yet. */
    changed?: ReadonlySet<string> | null;
    /** The silhouette of the whole walkable surface behind the regions (`MapData.art`). Not drawn yet. */
    art?: string | null;
    /** The selected callout. Not drawn yet. */
    selected?: string | null;
    /** Clicking or activating a region reports its id (the Map and Study screens). Not wired yet. */
    onregion?: (id: string) => void;
  }

  let { shapes, fit, level, label, interactive = false, names = false, truth = null, chosen = null, lit = null, cone = null, guess = null, marks = [], onpick }: Props = $props();

  // Zooming and panning override the fit until the fit itself changes (a new question, another floor).
  let view = $derived(fit);
  let svg = $state<SVGSVGElement>();

  const shown = $derived(shapes.filter((s) => s.level === level));
  const byId = $derived(new Map(shapes.map((s) => [s.id, s])));
  const truthShape = $derived(truth ? byId.get(truth) : undefined);
  const chosenShape = $derived(chosen ? byId.get(chosen) : undefined);
  const zoom = $derived(zoomLevel(view, fit));
  const unit = $derived(fit.w / 873);

  function toSvg(clientX: number, clientY: number): Point {
    const m = svg?.getScreenCTM();
    if (!svg || !m) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  /** Radar pixels per screen pixel: the picture is letterboxed, so the larger of the two ratios applies. */
  function unitsPerPixel(): number {
    const r = svg?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? Math.max(view.w / r.width, view.h / r.height) : 1;
  }

  let drag: { id: number; x: number; y: number; from: ViewBox; moved: boolean } | null = null;

  function down(e: PointerEvent) {
    if (!interactive || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) svg?.setPointerCapture(e.pointerId);
    drag.moved = true;
    const k = unitsPerPixel();
    view = panBy(drag.from, fit, -dx * k, -dy * k);
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.moved;
    drag = null;
    if (!wasDrag) onpick?.(toSvg(e.clientX, e.clientY));
  }
  function wheel(e: WheelEvent) {
    if (interactive) view = zoomAt(view, fit, toSvg(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0015));
  }
  const centre = (): Point => [view.x + view.w / 2, view.y + view.h / 2];
  const zoomBy = (factor: number) => (view = zoomAt(view, fit, centre(), factor));
  function key(e: KeyboardEvent) {
    if (!interactive || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomBy(1.6);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.6);
    else if (e.key === '0') view = fit;
  }
  function pressRegion(e: KeyboardEvent, s: MapShape) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onpick?.(s.anchor);
  }
</script>

<div class="stage" style:--ar={fit.w / fit.h} style:--k={zoom} style:--u={unit}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    class:interactive
    viewBox="{view.x} {view.y} {view.w} {view.h}"
    role={interactive ? 'group' : 'img'}
    aria-label={label}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (drag = null)}
    onwheel={wheel}
    onkeydown={key}
  >
    <g aria-hidden="true">
      {#each shown as s (s.id)}
        <path class="m-wall" d={s.d} />
      {/each}
    </g>
    <g>
      {#each shown as s (s.id)}
        {#if interactive && names}
          <path class="rg" class:lit={lit?.has(s.id)} d={s.d} role="button" tabindex="0" aria-label={s.name} onkeydown={(e) => pressRegion(e, s)} />
        {:else}
          <path class="rg" class:lit={lit?.has(s.id)} d={s.d} aria-hidden="true" />
        {/if}
      {/each}
    </g>
    {#if chosenShape && chosenShape.level === level}<path class="chosenline" d={chosenShape.d} />{/if}
    {#if truthShape && truthShape.level === level}<path class="truthfill" d={truthShape.d} />{/if}
    {#if cone}
      <path class="cone" d={cone.d} />
      <circle class="you" cx={cone.apex[0]} cy={cone.apex[1]} r={4.5 * unit / zoom} />
    {/if}
    {#if guess && truthShape}
      <path class="guessline" d="M{guess[0]} {guess[1]}L{truthShape.anchor[0]} {truthShape.anchor[1]}" />
      <path class="guessx" d="M{guess[0] - 8 * unit / zoom} {guess[1] - 8 * unit / zoom}l{16 * unit / zoom} {16 * unit / zoom}m0 {-16 * unit / zoom}l{-16 * unit / zoom} {16 * unit / zoom}" />
      <circle class="truthdot" cx={truthShape.anchor[0]} cy={truthShape.anchor[1]} r={8 * unit / zoom} />
    {:else if guess}
      <path class="guessx" d="M{guess[0] - 8 * unit / zoom} {guess[1] - 8 * unit / zoom}l{16 * unit / zoom} {16 * unit / zoom}m0 {-16 * unit / zoom}l{-16 * unit / zoom} {16 * unit / zoom}" />
    {/if}
    {#each marks as m (m.id)}
      {@const at = byId.get(m.id)?.anchor}
      {#if at}
        <text class="lbl" class:sel={m.tone === 'truth'} x={at[0]} y={at[1] - 12 * unit / zoom} aria-hidden="true">{m.text}</text>
      {/if}
    {/each}
  </svg>
</div>
{#if interactive}
  <div class="zoom">
    <button class="zbtn" type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.001} onclick={() => zoomBy(1.6)}>+</button>
    <button class="zbtn" type="button" aria-label="Zoom out" disabled={zoom <= 1.001} onclick={() => zoomBy(1 / 1.6)}>−</button>
  </div>
{/if}

<style>
  .stage {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  svg.interactive {
    cursor: crosshair;
    touch-action: none;
  }
  .m-wall {
    fill: var(--wall);
    stroke: var(--wall);
    stroke-width: calc(3px * var(--u) / var(--k));
    stroke-linejoin: round;
  }
  .rg {
    fill: var(--m-new);
    stroke: var(--surface);
    stroke-width: calc(1.6px * var(--u) / var(--k));
  }
  .rg.lit {
    fill: var(--m-familiar);
    stroke: var(--text);
    stroke-width: calc(1.6px * var(--u) / var(--k));
    stroke-dasharray: calc(5px * var(--u) / var(--k)) calc(3px * var(--u) / var(--k));
  }
  .interactive .rg:hover {
    stroke: var(--text);
    stroke-width: calc(2px * var(--u) / var(--k));
  }
  .rg:focus-visible {
    outline: none;
    stroke: var(--main);
    stroke-width: calc(2.6px * var(--u) / var(--k));
    stroke-dasharray: calc(5px * var(--u) / var(--k)) calc(3px * var(--u) / var(--k));
  }
  .truthfill {
    fill: var(--main);
    fill-opacity: 0.55;
    stroke: var(--main);
    stroke-width: calc(2px * var(--u) / var(--k));
    pointer-events: none;
    animation: fadein var(--t-reveal) ease-out both;
  }
  .chosenline {
    fill: var(--no-bg);
    fill-opacity: 0.7;
    stroke: var(--error);
    stroke-width: calc(2.4px * var(--u) / var(--k));
    pointer-events: none;
  }
  .cone {
    fill: var(--main);
    fill-opacity: 0.5;
    pointer-events: none;
  }
  .you {
    fill: var(--main);
    stroke: var(--bg);
    stroke-width: calc(2.5px * var(--u) / var(--k));
    pointer-events: none;
  }
  .guessline {
    fill: none;
    stroke: var(--text);
    stroke-width: calc(3px * var(--u) / var(--k));
    stroke-dasharray: calc(9px * var(--u) / var(--k)) calc(6px * var(--u) / var(--k));
    pointer-events: none;
    animation: draw var(--t-reveal) ease-out both;
  }
  .guessx {
    fill: none;
    stroke: var(--error);
    stroke-width: calc(5px * var(--u) / var(--k));
    stroke-linecap: square;
    pointer-events: none;
  }
  .truthdot {
    fill: var(--main);
    stroke: var(--bg);
    stroke-width: calc(3px * var(--u) / var(--k));
    pointer-events: none;
  }
  .lbl {
    font-family: var(--font);
    font-weight: 600;
    font-size: calc(13px * var(--u) / var(--k));
    text-transform: lowercase;
    fill: var(--text);
    stroke: var(--bg);
    stroke-width: calc(3.4px * var(--u) / var(--k));
    paint-order: stroke;
    stroke-linejoin: round;
    text-anchor: middle;
    pointer-events: none;
  }
  .lbl.sel {
    fill: var(--main);
    font-size: calc(15px * var(--u) / var(--k));
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 400;
      opacity: 0;
    }
    to {
      stroke-dashoffset: 0;
      opacity: 1;
    }
  }
  @keyframes fadein {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
