// Finds Svelte 4 syntax in .svelte files, for ADR 0001 rule 2 ("runes only"). Logic only; scripts/check-runes.mjs
// reads the files and prints the result.
//
// Why a separate guard when svelte.config.js already sets `runes: true`? The compiler rejects some of the old syntax
// (`export let`, `$:`, `$$props`, `beforeUpdate`/`afterUpdate`) but only warns about `<slot>` and `on:click`, and says
// nothing at all about `createEventDispatcher` (checked with Svelte 5.57 on small samples). A warning scrolls past in
// a build log; this fails the CI run. It also reads the files without compiling them, so one run lists every problem
// in every file instead of stopping at the first compile error.
//
// It reports only what is unambiguous, and it must not cry wolf, so it looks at tokens rather than text: the words in
// a comment, a string, a template literal or a paragraph of prose are not code. It is not a Svelte parser. It follows
// just enough of the file's structure (script blocks, tags and their attributes, `{...}` expressions, comments,
// <style>) to know which of those a given word sits in. See the test file for the shapes that are and are not flagged.

import { isOperatorWord, lexJs, type Token } from './js-lex';

export type RuleId = 'export-let' | 'reactive-statement' | 'slot' | 'on-directive' | 'event-dispatcher' | 'props-object' | 'update-hook';

export interface Rule {
  /** What the Svelte 4 feature is called, as a short noun phrase. */
  what: string;
  /** What to write instead. */
  instead: string;
}

export const RULES: Record<RuleId, Rule> = {
  'export-let': { what: 'prop declaration', instead: 'declare props with `let { name } = $props()`' },
  'reactive-statement': { what: 'reactive statement', instead: 'use `$derived` for values and `$effect` for side effects' },
  slot: { what: 'slot element', instead: 'take a `children` or named `Snippet` prop and render it with `{@render ...}`' },
  'on-directive': { what: 'event directive', instead: 'use the event attribute, for example `onclick={...}`' },
  'event-dispatcher': { what: 'event dispatcher', instead: 'take callback props, for example `onselect`' },
  'props-object': { what: 'props object', instead: 'use `$props()` and a rest element: `let { a, ...rest } = $props()`' },
  'update-hook': { what: 'update hook', instead: 'use `$effect.pre` / `$effect`' },
};

export interface Finding {
  rule: RuleId;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The offending text as written, for example `on:click`. */
  text: string;
}

interface Context {
  source: string;
  found: Finding[];
}

const add = (ctx: Context, rule: RuleId, offset: number, text: string): void => {
  const before = ctx.source.slice(0, offset);
  const line = before.split('\n').length;
  ctx.found.push({ rule, line, column: offset - (before.lastIndexOf('\n') + 1) + 1, text });
};

// A Map, not an object: `{}['constructor']` is a function, and a variable called `constructor` is not Svelte 4.
const WORD_RULES = new Map<string, RuleId>([
  ['createEventDispatcher', 'event-dispatcher'],
  ['$$props', 'props-object'],
  ['$$restProps', 'props-object'],
  ['beforeUpdate', 'update-hook'],
  ['afterUpdate', 'update-hook'],
]);

/** Tokens that cannot end an expression (an operator, `return`, `in`, ...), so a line break after one does not end the statement. */
const continuesExpression = (t: Token): boolean =>
  t.kind === 'punct' ? !(t.text === ')' || t.text === ']' || t.text === '++' || t.text === '--') : t.kind === 'ident' && isOperatorWord(t.text);

/** Is `tokens[k]` the first token of a statement? Needed so that `$:` the label is not confused with `a ? $ : b`. */
function startsStatement(tokens: Token[], k: number): boolean {
  const prev = tokens[k - 1];
  if (!prev) return true;
  if (prev.kind === 'punct' && (prev.text === ';' || prev.text === '}')) return true;
  // Without semicolons a line break ends the statement, unless the previous token needs something after it.
  return (tokens[k] as Token).newlineBefore && !continuesExpression(prev);
}

function checkTokens(ctx: Context, tokens: Token[], where: { script: boolean; module?: boolean }): void {
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k] as Token;
    if (t.kind !== 'ident') continue;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    const isMember = prev?.kind === 'punct' && prev.text === '.'; // `foo.afterUpdate` is somebody else's property
    const isKey = next?.kind === 'punct' && next.text === ':' && prev?.kind === 'punct' && (prev.text === '{' || prev.text === ','); // `{ afterUpdate: 1 }`

    const wordRule = WORD_RULES.get(t.text);
    if (wordRule && !isMember && !isKey) {
      add(ctx, wordRule, t.start, t.text);
    } else if (where.script && t.depth === 0 && !isMember) {
      // `export let` outside a module script (inside one it is a plain ES export, not a prop).
      if (t.text === 'export' && !where.module && next?.kind === 'ident' && next.text === 'let') {
        add(ctx, 'export-let', t.start, 'export let');
      } else if (t.text === '$' && next?.kind === 'punct' && next.text === ':' && startsStatement(tokens, k)) {
        add(ctx, 'reactive-statement', t.start, '$:');
      }
    }
  }
}

interface OpenTag {
  name: string;
  attrs: { name: string; start: number }[];
  /** Offset just after the closing `>`. */
  end: number;
}

/** Offset just after the `{...}` that starts at `from`, checking the expression inside it. */
function mustache(ctx: Context, from: number): number {
  let j = from + 1;
  while (/\s/.test(ctx.source[j] ?? '')) j += 1;
  if ('#:/@'.includes(ctx.source[j] ?? ' ')) j += 1; // {#if}, {:else}, {/if}, {@render}: a sigil, not code
  const { tokens, end } = lexJs(ctx.source, j, { stopAtCloseBrace: true });
  checkTokens(ctx, tokens, { script: false });
  return Math.min(end + 1, ctx.source.length);
}

/** Read the opening tag that starts at `from` (a `<`), or null if this `<` is just text. */
function openTag(ctx: Context, from: number): OpenTag | null {
  const src = ctx.source;
  const name = /^<([A-Za-z][\w:.-]*)/.exec(src.slice(from, from + 80))?.[1];
  if (name === undefined) return null;
  const attrs: OpenTag['attrs'] = [];
  let j = from + 1 + name.length;

  while (j < src.length) {
    while (/\s/.test(src[j] ?? '')) j += 1;
    if (src[j] === '>') return { name, attrs, end: j + 1 };
    if (src[j] === '/' && src[j + 1] === '>') return { name, attrs, end: j + 2 };
    if (src[j] === '{') { j = mustache(ctx, j); continue; } // `{...spread}` or shorthand `{value}`

    const attr = /^[^\s=>/{}"']+/.exec(src.slice(j, j + 200))?.[0];
    if (attr === undefined) { j += 1; continue; }
    attrs.push({ name: attr, start: j });
    j += attr.length;
    while (/\s/.test(src[j] ?? '')) j += 1;
    if (src[j] !== '=') continue;
    j += 1;
    while (/\s/.test(src[j] ?? '')) j += 1;

    const quote = src[j];
    if (quote === '"' || quote === "'") {
      j += 1;
      while (j < src.length && src[j] !== quote) j = src[j] === '{' ? mustache(ctx, j) : j + 1; // text, with {expressions}
      j += 1;
    } else if (quote === '{') {
      j = mustache(ctx, j);
    } else {
      while (j < src.length && !/[\s>]/.test(src[j] as string)) j += 1; // unquoted value
    }
  }
  return { name, attrs, end: src.length };
}

/** Find Svelte 4 syntax in the text of a .svelte file. Findings come in file order. */
export function findSvelte4Syntax(source: string): Finding[] {
  const ctx: Context = { source, found: [] };
  let i = 0;

  while (i < source.length) {
    if (source[i] === '{') { i = mustache(ctx, i); continue; }
    if (source[i] !== '<') { i += 1; continue; }

    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }
    const tag = openTag(ctx, i);
    if (!tag) { i += 1; continue; }

    if (tag.name === 'slot') add(ctx, 'slot', i, '<slot');
    for (const a of tag.attrs) {
      if (/^on:[A-Za-z_]/.test(a.name)) add(ctx, 'on-directive', a.start, a.name);
    }

    const lower = tag.name.toLowerCase();
    if (lower === 'script' || lower === 'style') {
      // The body is a different language and ends at the first closing tag, as Svelte reads it.
      const closing = new RegExp(`</${lower}\\s*>`, 'i').exec(source.slice(tag.end));
      const bodyEnd = closing ? tag.end + closing.index : source.length;
      if (lower === 'script') {
        const attrNames = tag.attrs.map((a) => a.name.toLowerCase());
        const header = source.slice(i, tag.end);
        const isModule = attrNames.includes('module') || /\bcontext\s*=\s*["']?module\b/i.test(header);
        checkTokens(ctx, lexJs(source.slice(0, bodyEnd), tag.end).tokens, { script: true, module: isModule });
      }
      i = closing ? bodyEnd + closing[0].length : source.length;
      continue;
    }
    i = tag.end;
  }
  return ctx.found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** One line of output for a finding: `src/App.svelte:12:3  on:click: Svelte 4 event directive; use the event attribute...`. */
export function formatFinding(file: string, f: Finding): string {
  const rule = RULES[f.rule];
  return `${file}:${f.line}:${f.column}  ${f.text}: Svelte 4 ${rule.what}; ${rule.instead}`;
}
