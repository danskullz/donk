import { describe, expect, it } from 'vitest';
import { findSvelte4Syntax, formatFinding } from './runes-guard';

const rules = (source: string): string[] => findSvelte4Syntax(source).map((f) => f.rule);
const script = (body: string, attrs = ''): string => `<script${attrs}>\n${body}\n</script>\n<p>x</p>`;

describe('real Svelte 4 syntax is found', () => {
  it('export let', () => {
    expect(rules(script('export let name = "x";'))).toEqual(['export-let']);
    expect(rules(script('  export   let count: number;'))).toEqual(['export-let']);
    expect(rules(script('export\nlet y;'))).toEqual(['export-let']);
  });

  it('$: reactive statements, with and without semicolons', () => {
    expect(rules(script('let a = 1, b;\n$: b = a * 2;'))).toEqual(['reactive-statement']);
    expect(rules(script('let a = 1\nlet b\n$: b = a * 2\n$: console.log(b)'))).toEqual(['reactive-statement', 'reactive-statement']);
    expect(rules(script('$: ({ a, b } = pair);'))).toEqual(['reactive-statement']);
    expect(rules(script('function f() {}\n$: f();'))).toEqual(['reactive-statement']);
    expect(rules(script('$: { doSomething(); }'))).toEqual(['reactive-statement']);
  });

  it('<slot>, in any of its forms', () => {
    expect(rules('<div><slot /></div>')).toEqual(['slot']);
    expect(rules('<div><slot name="header">fallback</slot></div>')).toEqual(['slot']);
    expect(rules('<slot\n  name="x"\n/>')).toEqual(['slot']);
  });

  it('on:event directives, on elements, components and svelte: elements', () => {
    expect(rules('<button on:click={go}>x</button>')).toEqual(['on-directive']);
    expect(rules('<button on:click|preventDefault={go}>x</button>')).toEqual(['on-directive']);
    expect(rules('<Child on:select={pick} />')).toEqual(['on-directive']);
    expect(rules('<svelte:window on:keydown={key} on:resize={size} />')).toEqual(['on-directive', 'on-directive']);
    expect(rules('<input value={v}\n  on:input={(e) => { v = e.currentTarget.value; }}>')).toEqual(['on-directive']);
  });

  it('createEventDispatcher, as an import and as a call', () => {
    expect(rules(script(`import { createEventDispatcher } from 'svelte';\nconst dispatch = createEventDispatcher();`))).toEqual([
      'event-dispatcher',
      'event-dispatcher',
    ]);
  });

  it('$$props and $$restProps, in script and in markup', () => {
    expect(rules(script('const all = $$props;'))).toEqual(['props-object']);
    expect(rules('<div {...$$restProps} class={$$props.class}></div>')).toEqual(['props-object', 'props-object']);
  });

  it('beforeUpdate and afterUpdate', () => {
    expect(rules(script(`import { beforeUpdate, afterUpdate } from 'svelte';\nafterUpdate(() => {});`))).toEqual([
      'update-hook',
      'update-hook',
      'update-hook',
    ]);
  });

  it('reports line, column and the text as written', () => {
    const src = '<script>\n  let a;\n  export let b;\n</script>\n\n<button\n  class="x"\n  on:click|once={go}\n>x</button>\n<slot />';
    expect(findSvelte4Syntax(src)).toEqual([
      { rule: 'export-let', line: 3, column: 3, text: 'export let' },
      { rule: 'on-directive', line: 8, column: 3, text: 'on:click|once' },
      { rule: 'slot', line: 10, column: 1, text: '<slot' },
    ]);
  });

  it('keeps finding things after a regular expression with quotes in it', () => {
    // A tokeniser that read the regex as division would take the quote for a string and miss the `$:` after it.
    expect(rules(script(`const re = /["']+/g;\n$: x = 1;`))).toEqual(['reactive-statement']);
  });

  it('formats a finding with the replacement to use', () => {
    const [f] = findSvelte4Syntax('<button on:click={go}>x</button>');
    expect(f && formatFinding('src/A.svelte', f)).toBe(
      `src/A.svelte:1:9  on:click: Svelte 4 event directive; use the event attribute, for example \`onclick={...}\``,
    );
  });
});

describe('false positives: the same words that are not code', () => {
  it('ignores line and block comments in a script', () => {
    const body = [
      '// export let name = "x";',
      '/* export let other;',
      '   $: b = a * 2; */',
      '// $: nothing, <slot />, on:click, createEventDispatcher, $$props, beforeUpdate',
      'let ok = 1;',
    ].join('\n');
    expect(rules(script(body))).toEqual([]);
  });

  it('ignores strings and template literals in a script', () => {
    const body = [
      `const a = 'export let x';`,
      `const b = "$: y = 1";`,
      'const c = `$: ${ok} export let z`;',
      'const d = `on:click on the <slot /> and createEventDispatcher and $$props`;',
      `const e = 'afterUpdate';`,
    ].join('\n');
    expect(rules(script(body))).toEqual([]);
  });

  it('still reads code inside ${} of a template literal', () => {
    expect(rules(script('const c = `a ${ $$props.x } b`;'))).toEqual(['props-object']);
  });

  it('ignores HTML comments', () => {
    expect(rules('<!-- <slot /> and <button on:click={x}> and {$$props} -->\n<p>ok</p>')).toEqual([]);
  });

  it('ignores on: and other words in plain prose', () => {
    expect(rules('<p>turn on: the lights, then on:click is the old way. Do not use $: or export let or createEventDispatcher.</p>')).toEqual([]);
    expect(rules('<p>the slot machine paid out, <code>&lt;slot&gt;</code> is deprecated; $$props too</p>')).toEqual([]);
  });

  it('ignores on: inside an attribute value or an expression string', () => {
    expect(rules('<button title="on:click" aria-label=\'on:input\' data-note="<slot />">x</button>')).toEqual([]);
    expect(rules(`<button onclick={() => log('on:click and $: and export let')}>x</button>`)).toEqual([]);
  });

  it('ignores attributes that only look like directives', () => {
    expect(rules('<div data-on:x="1" ion:thing="2" onclick={go} bind:value={v} use:act class:on={true} in:fade out:fade>x</div>')).toEqual([]);
  });

  it('ignores <style> contents', () => {
    expect(rules('<style>\n  /* on:click <slot /> */\n  .x::slotted(p) { color: red; }\n  .on\\:x { color: red; }\n</style>')).toEqual([]);
  });

  it('ignores elements and components that only start with the letters "slot"', () => {
    expect(rules('<slot-machine></slot-machine><Slot /><slots-list />')).toEqual([]);
  });

  it('ignores a property or object key with a Svelte 4 name', () => {
    expect(rules(script('const t = lifecycle.afterUpdate; const o = { beforeUpdate: 1, afterUpdate: 2 };'))).toEqual([]);
  });

  it('ignores ordinary words that are also properties of Object.prototype', () => {
    expect(rules(script('const constructor = 1; const toString = 2; hasOwnProperty(valueOf);'))).toEqual([]);
  });

  it('does not take a ternary, an object key or a nested label for a reactive statement', () => {
    expect(rules(script('const v = cond ? $ : other;'))).toEqual([]);
    expect(rules(script('const o = { $: 1 };'))).toEqual([]);
    expect(rules(script('const w = cond ?\n$ : other;'))).toEqual([]);
    expect(rules(script('function f() {\n  $: for (;;) { break $; }\n}'))).toEqual([]);
  });

  it('does not take export let in a module script for a prop', () => {
    expect(rules(script('export let shared = 1;', ' module'))).toEqual([]);
    expect(rules(script('export let shared = 1;', ' context="module"'))).toEqual([]);
    expect(rules(script('export const a = 1; export function b() {}; export { a as c };'))).toEqual([]);
  });

  it('does not take a name that merely contains $ for the label', () => {
    expect(rules(script('let a$ = 1;\na$: 2;\nlet $$x = 1;'))).toEqual([]);
  });
});

describe('Svelte 5 code is clean', () => {
  it('passes a typical runes component', () => {
    const src = `<script lang="ts">
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  interface Props { label: string; onselect?: (id: string) => void; children?: Snippet; }
  let { label, onselect, children, ...rest }: Props = $props();
  let count = $state(0);
  const doubled = $derived(count * 2);
  $effect(() => { console.log(doubled, label); });
  const re = /on:click|<slot>/g;
</script>

<button {...rest} onclick={() => { count += 1; onselect?.(label); }}>{label} {doubled}</button>
{#if children}{@render children()}{:else}<span>none</span>{/if}
{#each [1, 2] as n (n)}<i>{n}</i>{/each}
{#snippet row(x: number)}<b>{x}</b>{/snippet}
<svelte:window onkeydown={(e) => e.key} />

<style>
  button { color: red; }
</style>`;
    expect(rules(src)).toEqual([]);
  });

  it('is not thrown off by closing blocks, spreads, generics or unusual braces', () => {
    const src = `<script lang="ts" generics="T extends Record<string, number>">
  let { items }: { items: T[] } = $props();
</script>
{#if items.length > 0}
  {#each items as item}
    <p class="a {item ? 'b' : 'c'} d">{'}'} {\`}\`} {item /* c */}</p>
  {/each}
{/if}`;
    expect(rules(src)).toEqual([]);
    expect(rules(`${src}\n<slot />`)).toEqual(['slot']);
  });

  it('copes with empty and unfinished input', () => {
    expect(rules('')).toEqual([]);
    expect(rules('<script>')).toEqual([]);
    expect(rules('<div on:click={')).toEqual(['on-directive']);
    expect(rules('{#if x')).toEqual([]);
  });
});
