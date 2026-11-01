<script lang="ts" module>
  export interface Mark {
    id: string;
    text: string;
    tone: 'truth' | 'chosen';
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { smallestRegionAt, type Point } from '../core/geometry';
  import { MAX_ZOOM, centreOn, panBy, zoomAt, zoomLevel, type ConeShape, type MapShape, type ViewBox } from '../core/mapview';
  import { assistView, clientToView, neighbourInDirection, parsePath, pinchView, pixelsPerUnit, placeLabels, revealView, screenSide, type Direction, type LabelBox } from '../core/mapui';
  import type { Mastery } from '../core/types';

  interface Props {
    shapes: readonly MapShape[];
    /** The view that shows everything: where the map starts, and the most it zooms out. */
    fit: ViewBox;
    /** Which floor is drawn. */
    level: string;
    label: string;
    /** Clicks pick a point, the wheel, a pinch and the buttons zoom, dragging pans. */
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
    // ---- the map as a progress display (work package A); other screens only pass these ----
    /** Mastery state of each callout by id: the map as a progress bar (SCOPE §4.5). Colour is never the only signal:
     *  New is flat, Seen is striped, Learning is dotted, the rest climb the ramp. */
    fills?: Readonly<Record<string, Mastery>> | null;
    /** Callouts to emphasise, for example those that moved up in a session (the Summary screen): a bright outline. */
    changed?: ReadonlySet<string> | null;
    /** The silhouette of the whole walkable surface behind the regions (`MapData.art`). Without it the wall is the
     *  union of the regions themselves. */
    art?: string | null;
    /** The selected callout: ringed. */
    selected?: string | null;
    /** Clicking or activating a region reports its id. The smallest region under the pointer wins, so a Hard spot
     *  inside a callout can be reached while the rest of the callout still answers to the callout. */
    onregion?: (id: string) => void;
    /** Draw each callout's name where there is room (names that would collide are left out; zoom to see them). */
    labels?: boolean;
    /** The small overview with the visible window while zoomed in (hidden on phones). */
    minimap?: boolean;
    /** Several floors: a switcher is drawn when there is more than one and `onlevel` is given. */
    levels?: readonly string[];
    onlevel?: (level: string) => void;
    /** Regions under 44 px on screen zoom in on a first touch tap instead of being a tiny target (SCOPE §5.4). */
    assist?: boolean;
    /** Keep the selected region in view: pan to it, and zoom in when it is too small to see. */
    follow?: boolean;
    /** A still thumbnail (the Home picker): thin lines, no controls. */
    compact?: boolean;
    /** The open zone on the Map screen: regions outside this set are dimmed and left unlabelled. */
    focus?: ReadonlySet<string> | null;
  }

  let {
    shapes,
    fit,
    level,
    label,
    interactive = false,
    names = false,
    truth = null,
    chosen = null,
    lit = null,
    cone = null,
    guess = null,
    marks = [],
    onpick,
    fills = null,
    changed = null,
    art = null,
    selected = null,
    onregion,
    labels = false,
    minimap = true,
    levels = [],
    onlevel,
    assist = true,
    follow = false,
    compact = false,
    focus = null,
  }: Props = $props();

  // Several maps can share a page (the Home picker); every pattern id has to be unique to this one.
  const uid = $props.id();

  // Zooming and panning override the fit until the fit itself changes (a new question, another floor).
  let view = $derived(fit);
  let svg = $state<SVGSVGElement>();
  let boxW = $state(0);
  let boxH = $state(0);

  const shown = $derived(shapes.filter((s) => s.level === level));
  const byId = $derived(new Map(shapes.map((s) => [s.id, s])));
  const regions = $derived(shown.map((s) => ({ id: s.id, polygon: parsePath(s.d), shape: s })));
  const truthShape = $derived(truth ? byId.get(truth) : undefined);
  const chosenShape = $derived(chosen ? byId.get(chosen) : undefined);
  const selectedShape = $derived(selected ? shown.find((s) => s.id === selected) : undefined);
  const changedShapes = $derived(changed ? shown.filter((s) => changed.has(s.id)) : []);
  const zoom = $derived(zoomLevel(view, fit));
  /** Radar pixels per screen pixel: every line, dash, dot and letter is sized in screen pixels through this. */
  const px = $derived(boxW > 0 && boxH > 0 ? 1 / pixelsPerUnit(view, { width: boxW, height: boxH }) : fit.w / 873);
  const focusable = $derived(interactive && (names || onregion !== undefined));

  // ---------------------------------------------------------------------------------------------- coordinates

  const rectOf = () => {
    const r = svg?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
  };

  function toSvg(clientX: number, clientY: number): Point {
    const m = svg?.getScreenCTM();
    if (!svg || !m) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  // ----------------------------------------------------------------------------------- pointer: drag, tap, pinch

  const fingers = new Map<number, Point>();
  let drag: { id: number; x: number; y: number; from: ViewBox; moved: boolean } | null = null;
  let pinch: { a: number; b: number; a0: Point; b0: Point; start: ViewBox } | null = null;
  /** A second finger touched down: nothing from this touch counts as a tap. */
  let gesture = false;

  function capture(id: number) {
    try {
      svg?.setPointerCapture(id);
    } catch {
      // the pointer is already gone (or synthetic): the gesture still works on the events that arrive
    }
  }

  function down(e: PointerEvent) {
    if (!interactive || e.button !== 0) return;
    if (e.pointerType === 'mouse') {
      // a mouse is one pointer: whatever is left from a press that ended outside the map is stale
      fingers.clear();
      pinch = null;
      gesture = false;
    }
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 1) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view, moved: false };
    } else if (fingers.size === 2) {
      const [first, second] = [...fingers] as [[number, Point], [number, Point]];
      pinch = { a: first[0], b: second[0], a0: first[1], b0: second[1], start: view };
      drag = null;
      gesture = true;
      capture(first[0]);
      capture(second[0]);
    }
  }
  function move(e: PointerEvent) {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch) {
      const a = fingers.get(pinch.a);
      const b = fingers.get(pinch.b);
      if (a && b) view = pinchView(pinch.start, fit, rectOf(), pinch.a0, pinch.b0, a, b);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) capture(e.pointerId);
    drag.moved = true;
    view = panBy(drag.from, fit, -dx * px, -dy * px);
  }
  function release(id: number): boolean {
    fingers.delete(id);
    if (pinch && (id === pinch.a || id === pinch.b)) pinch = null;
    if (fingers.size > 0) return false;
    const wasGesture = gesture;
    gesture = false;
    return !wasGesture;
  }
  function up(e: PointerEvent) {
    if (!fingers.has(e.pointerId)) return;
    const mine = drag?.id === e.pointerId ? drag : null;
    if (!release(e.pointerId) || !mine) {
      if (!mine) drag = null;
      return;
    }
    drag = null;
    if (!mine.moved) tap(e);
  }
  function cancel(e: PointerEvent) {
    release(e.pointerId);
    drag = null;
  }

  /** A click or tap: report the region under it (the smallest one), or the point. */
  function tap(e: PointerEvent) {
    const p = toSvg(e.clientX, e.clientY);
    const hit = smallestRegionAt(p, regions);
    if (hit && assist && e.pointerType !== 'mouse') {
      const closer = assistView(view, fit, rectOf(), hit.shape.bounds);
      if (closer) {
        view = closer;
        return;
      }
    }
    if (hit) onregion?.(hit.id);
    onpick?.(p);
  }

  // The wheel listener is not passive so that a pinch on a trackpad (it arrives as ctrl + wheel) zooms the map and not the page.
  $effect(() => {
    const el = svg;
    if (!el || !interactive) return;
    const onwheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      view = zoomAt(view, fit, toSvg(e.clientX, e.clientY), Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', onwheel, { passive: false });
    return () => el.removeEventListener('wheel', onwheel);
  });

  // ---------------------------------------------------------------------------------------------------- keyboard

  const els: Record<string, SVGPathElement | undefined> = {};
  /** The region that last had the keyboard focus: the one tab lands on (a roving tab stop, so 50 regions are not 50 stops). */
  let focusId = $state<string | null>(null);
  /** Shown as a ring only when the focus came from the keyboard. */
  let ringId = $state<string | null>(null);
  $effect(() => {
    void selected;
    focusId = null;
  });
  const stopId = $derived((focusId && shown.some((s) => s.id === focusId) ? focusId : null) ?? (selectedShape ? selectedShape.id : null) ?? shown[0]?.id ?? null);
  const ringShape = $derived(ringId ? shown.find((s) => s.id === ringId) : undefined);

  const centre = (): Point => [view.x + view.w / 2, view.y + view.h / 2];
  const zoomBy = (factor: number) => (view = zoomAt(view, fit, centre(), factor));

  const DIRECTION: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  function key(e: KeyboardEvent) {
    if (!interactive || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = DIRECTION[e.key];
    if (dir && focusable) {
      const from = focusId ?? stopId;
      const next = from ? neighbourInDirection(shown, from, dir) : null;
      e.preventDefault();
      if (next) focusRegion(next);
    } else if (e.key === '+' || e.key === '=') zoomBy(1.6);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.6);
    else if (e.key === '0') view = fit;
  }
  function focusRegion(id: string) {
    const s = byId.get(id);
    els[id]?.focus({ preventScroll: true });
    if (s) view = revealView(view, fit, { width: boxW, height: boxH }, s.bounds, 0);
  }
  function pressRegion(e: KeyboardEvent, s: MapShape) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onregion?.(s.id);
    onpick?.(s.anchor);
  }

  // A region chosen elsewhere (a row in the list) is brought into view.
  $effect(() => {
    const measured = boxW > 0 && boxH > 0;
    const s = follow && selected && measured ? untrack(() => selectedShape) : undefined;
    if (!s) return;
    untrack(() => (view = revealView(view, fit, { width: boxW, height: boxH }, s.bounds)));
  });

  // ----------------------------------------------------------------------------------------------- the minimap

  let miniEl = $state<HTMLDivElement>();
  function recentre(e: PointerEvent) {
    if (!miniEl || (e.type === 'pointermove' && e.buttons === 0)) return;
    const r = miniEl.querySelector('svg')?.getBoundingClientRect();
    if (!r) return;
    view = centreOn(view, fit, clientToView(fit, { left: r.left, top: r.top, width: r.width, height: r.height }, e.clientX, e.clientY));
  }
  function miniDown(e: PointerEvent) {
    try {
      miniEl?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer
    }
    recentre(e);
  }

  // ------------------------------------------------------------------------------------------------- appearance

  const fillOf = (id: string): string | undefined => {
    const m = fills?.[id];
    if (!m || lit?.has(id)) return undefined;
    if (m === 'seen' || m === 'learning') return `url(#${uid}-${m})`;
    return `var(--m-${m === 'automatic' ? 'auto' : m})`;
  };
  const nameOf = (s: MapShape) => {
    const state = fills?.[s.id];
    return `${s.name}${state ? `, ${state}` : ''}${changed?.has(s.id) ? ', changed' : ''}`;
  };

  const LABEL_PX = 12;
  const HARD_LABEL_PX = 10.5;
  const SELECTED_LABEL_PX = 14;
  /** Names the map can show at this size and zoom. Phones show only the selected one: the others would collide. */
  const labelled = $derived.by(() => {
    if (!labels) return [];
    const rect = { width: boxW, height: boxH };
    const wide = boxW >= 520;
    const boxes: LabelBox[] = [];
    for (const s of shown) {
      const isSel = s.id === selected;
      if (!isSel && (!wide || (focus && !focus.has(s.id)))) continue;
      if (!isSel && s.tier === 3 && screenSide(view, rect, s.bounds) < 22) continue;
      const fs = isSel ? SELECTED_LABEL_PX : s.tier === 3 ? HARD_LABEL_PX : LABEL_PX;
      boxes.push({ id: s.id, x: s.anchor[0], y: s.anchor[1], w: (s.name.length * 0.6 * fs + 6) * px, h: fs * 1.3 * px, priority: (isSel ? 1000 : 0) + (4 - s.tier) * 10 + Math.log10(s.area + 1) });
    }
    const keep = placeLabels(boxes);
    return shown.filter((s) => keep.has(s.id)).map((s) => ({ shape: s, fs: s.id === selected ? SELECTED_LABEL_PX : s.tier === 3 ? HARD_LABEL_PX : LABEL_PX }));
  });
</script>

<div class="stage" class:compact bind:clientWidth={boxW} bind:clientHeight={boxH} style:--px={px} style:--ar={fit.w / fit.h} data-zoom={zoom.toFixed(2)}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    class:interactive
    class:pick={onregion !== undefined && onpick === undefined}
    viewBox="{view.x} {view.y} {view.w} {view.h}"
    role={interactive ? 'group' : 'img'}
    aria-label={label}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancel}
    onkeydown={key}
  >
    <defs>
      <pattern id="{uid}-seen" width={6 * px} height={6 * px} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6 * px} height={6 * px} style:fill="var(--m-new)" />
        <rect width={1.6 * px} height={6 * px} style:fill="var(--m-seen-line)" />
      </pattern>
      <pattern id="{uid}-learning" width={7 * px} height={7 * px} patternUnits="userSpaceOnUse">
        <rect width={7 * px} height={7 * px} style:fill="var(--m-learning)" />
        <circle cx={3.5 * px} cy={3.5 * px} r={1.5 * px} style:fill="var(--m-learning-dot)" />
      </pattern>
    </defs>
    <g aria-hidden="true">
      {#if art}
        <path class="m-wall" d={art} />
      {:else}
        {#each shown as s (s.id)}
          <path class="m-wall" d={s.d} />
        {/each}
      {/if}
    </g>
    <g>
      {#each shown as s (s.id)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <path
          bind:this={els[s.id]}
          class="rg"
          class:lit={lit?.has(s.id)}
          class:dim={focus && !focus.has(s.id)}
          class:hs={s.tier === 3}
          class:fresh={s.tier === 3 && (!fills || fills[s.id] === 'new')}
          style:fill={fillOf(s.id)}
          d={s.d}
          data-id={s.id}
          data-mastery={fills?.[s.id]}
          role={focusable ? 'button' : undefined}
          tabindex={focusable ? (s.id === stopId ? 0 : -1) : undefined}
          aria-label={focusable ? nameOf(s) : undefined}
          aria-pressed={focusable && onregion ? s.id === selected : undefined}
          aria-hidden={focusable ? undefined : 'true'}
          onkeydown={focusable ? (e) => pressRegion(e, s) : undefined}
          onfocus={focusable
            ? (e) => {
                focusId = s.id;
                ringId = (e.currentTarget as Element).matches(':focus-visible') ? s.id : null;
              }
            : undefined}
          onblur={focusable ? () => (ringId = null) : undefined}
        />
      {/each}
    </g>
    {#each changedShapes as s (s.id)}
      <path class="halo" d={s.d} />
      <path class="chg" d={s.d} />
    {/each}
    {#if selectedShape}
      <path class="halo wide" d={selectedShape.d} />
      <path class="ring" d={selectedShape.d} />
    {/if}
    {#if ringShape && ringShape.id !== selectedShape?.id}
      <path class="halo" d={ringShape.d} />
      <path class="ring dashed" d={ringShape.d} />
    {/if}
    {#if chosenShape && chosenShape.level === level}<path class="chosenline" d={chosenShape.d} />{/if}
    {#if truthShape && truthShape.level === level}<path class="truthfill" d={truthShape.d} />{/if}
    {#each labelled as l (l.shape.id)}
      <text
        class="lbl"
        class:sel={l.shape.id === selected}
        class:hard={l.shape.tier === 3}
        x={l.shape.anchor[0]}
        y={l.shape.anchor[1] + 0.35 * l.fs * px}
        style:font-size="{l.fs * px}px"
        style:stroke-width="{0.26 * l.fs * px}px"
        aria-hidden="true">{l.shape.name}</text
      >
    {/each}
    {#if cone}
      <path class="cone" d={cone.d} />
      <circle class="you" cx={cone.apex[0]} cy={cone.apex[1]} r={4.5 * px} />
    {/if}
    {#if guess && truthShape}
      <path class="guessline" d="M{guess[0]} {guess[1]}L{truthShape.anchor[0]} {truthShape.anchor[1]}" />
      <path class="guessx" d="M{guess[0] - 8 * px} {guess[1] - 8 * px}l{16 * px} {16 * px}m0 {-16 * px}l{-16 * px} {16 * px}" />
      <circle class="truthdot" cx={truthShape.anchor[0]} cy={truthShape.anchor[1]} r={8 * px} />
    {:else if guess}
      <path class="guessx" d="M{guess[0] - 8 * px} {guess[1] - 8 * px}l{16 * px} {16 * px}m0 {-16 * px}l{-16 * px} {16 * px}" />
    {/if}
    {#each marks as m (m.id)}
      {@const at = byId.get(m.id)?.anchor}
      {#if at}
        <text class="lbl" class:sel={m.tone === 'truth'} x={at[0]} y={at[1] - 12 * px} aria-hidden="true">{m.text}</text>
      {/if}
    {/each}
  </svg>
</div>
{#if interactive}
  <div class="corner">
    {#if levels.length > 1 && onlevel}
      <div class="tabs levels" role="tablist" aria-label="Floor">
        {#each levels as id (id)}
          <button class="tab" type="button" role="tab" aria-selected={id === level} onclick={() => onlevel(id)}>{id}</button>
        {/each}
      </div>
    {/if}
    {#if minimap && zoom > 1.001}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="minimap" bind:this={miniEl} aria-label="Zoom position" onpointerdown={miniDown} onpointermove={recentre}>
        <svg viewBox="{fit.x} {fit.y} {fit.w} {fit.h}" aria-hidden="true">
          {#if art}
            <path class="m-sil" d={art} />
          {:else}
            {#each shown as s (s.id)}<path class="m-sil" d={s.d} />{/each}
          {/if}
          <rect class="vp" x={view.x} y={view.y} width={view.w} height={view.h} />
        </svg>
      </div>
    {/if}
  </div>
  <div class="zoom">
    <button class="zbtn" type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.001} onclick={() => zoomBy(1.6)}>+</button>
    <button class="zbtn" type="button" aria-label="Zoom out" disabled={zoom <= 1.001} onclick={() => zoomBy(1 / 1.6)}>−</button>
    <button class="zbtn zfit" type="button" aria-label="Fit to frame" disabled={zoom <= 1.001} onclick={() => (view = fit)}>fit</button>
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
  svg.interactive.pick {
    cursor: pointer;
  }
  .m-wall {
    fill: var(--wall);
    stroke: var(--wall);
    stroke-width: calc(3px * var(--px));
    stroke-linejoin: round;
  }
  .rg {
    fill: var(--m-new);
    stroke: var(--surface);
    stroke-width: calc(1.6px * var(--px));
  }
  /* A Hard spot is an inlay: a thin light outline on its parent, dashed while it is still New. */
  .rg.hs {
    stroke: var(--text);
    stroke-width: calc(1.4px * var(--px));
  }
  .rg.hs.fresh {
    stroke-dasharray: calc(5px * var(--px)) calc(3px * var(--px));
  }
  /* Outside the open zone: darker, not fainter. Fading would let the wall colour show through, and a New region (the
     darkest fill) would then look brighter than the zone that is in focus. */
  .rg.dim {
    filter: brightness(0.55);
  }
  .rg.lit {
    fill: var(--m-familiar);
    stroke: var(--text);
    stroke-width: calc(1.6px * var(--px));
    stroke-dasharray: calc(5px * var(--px)) calc(3px * var(--px));
  }
  .interactive .rg:hover {
    stroke: var(--text);
    stroke-width: calc(2px * var(--px));
  }
  .rg:focus-visible {
    outline: none;
  }
  .compact .m-wall {
    stroke-width: calc(1.2px * var(--px));
  }
  .compact .rg {
    stroke-width: calc(0.5px * var(--px));
  }
  /* Rings are drawn over the regions with a dark band on both sides, so a lime ring stays visible on a lime region. */
  .halo,
  .ring,
  .chg {
    fill: none;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .halo {
    stroke: var(--bg);
    stroke-width: calc(6.5px * var(--px));
  }
  .halo.wide {
    stroke-width: calc(7.5px * var(--px));
  }
  .ring {
    stroke: var(--main);
    stroke-width: calc(2.6px * var(--px));
  }
  .ring.dashed {
    stroke-dasharray: calc(5px * var(--px)) calc(3px * var(--px));
  }
  .chg {
    stroke: var(--text);
    stroke-width: calc(2.4px * var(--px));
  }
  .truthfill {
    fill: var(--main);
    fill-opacity: 0.55;
    stroke: var(--main);
    stroke-width: calc(2px * var(--px));
    pointer-events: none;
    animation: fadein var(--t-reveal) ease-out both;
  }
  .chosenline {
    fill: var(--no-bg);
    fill-opacity: 0.7;
    stroke: var(--error);
    stroke-width: calc(2.4px * var(--px));
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
    stroke-width: calc(2.5px * var(--px));
    pointer-events: none;
  }
  .guessline {
    fill: none;
    stroke: var(--text);
    stroke-width: calc(3px * var(--px));
    stroke-dasharray: calc(9px * var(--px)) calc(6px * var(--px));
    pointer-events: none;
    animation: draw var(--t-reveal) ease-out both;
  }
  .guessx {
    fill: none;
    stroke: var(--error);
    stroke-width: calc(5px * var(--px));
    stroke-linecap: square;
    pointer-events: none;
  }
  .truthdot {
    fill: var(--main);
    stroke: var(--bg);
    stroke-width: calc(3px * var(--px));
    pointer-events: none;
  }
  .lbl {
    font-family: var(--font);
    font-weight: 600;
    font-size: calc(13px * var(--px));
    text-transform: lowercase;
    fill: var(--text);
    stroke: var(--bg);
    stroke-width: calc(3.4px * var(--px));
    paint-order: stroke;
    stroke-linejoin: round;
    text-anchor: middle;
    pointer-events: none;
  }
  .lbl.hard {
    font-weight: 500;
  }
  .lbl.sel {
    fill: var(--main);
    font-size: calc(15px * var(--px));
  }

  .corner {
    position: absolute;
    z-index: 2;
    left: var(--s3);
    top: var(--s3);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    pointer-events: none;
  }
  .corner > * {
    pointer-events: auto;
  }
  .levels {
    gap: var(--s2);
    padding: 0 var(--s2);
    background: var(--bg);
  }
  .minimap {
    width: 118px;
    padding: 4px;
    background: var(--bg);
    cursor: pointer;
    touch-action: none;
  }
  .minimap svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .minimap .m-sil {
    fill: var(--m-new);
    stroke: var(--wall);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .minimap .vp {
    fill: none;
    stroke: var(--main);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }
  .zfit {
    font-size: var(--fs-sm);
  }
  @media (max-width: 820px) and (max-aspect-ratio: 4/3) {
    .minimap {
      display: none;
    }
    .corner {
      left: var(--s2);
      top: var(--s2);
    }
  }
  @media (max-height: 520px) and (min-aspect-ratio: 4/3) {
    .minimap {
      width: 76px;
    }
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
