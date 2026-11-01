// A small JavaScript/TypeScript tokeniser for the build checks (budget.ts, runes-guard.ts). It is not a parser: it only
// has to tell code from strings, comments, template text and regular expressions, so that a check looking for
// `import ...` or `$:` is not fooled by those words appearing inside a string or a comment. Two checks need exactly
// that, so the fiddly part lives here once.
//
// Known limit: `/` is either division or the start of a regular expression, and only a parser knows which. This
// uses the usual rule (look at the previous token), which is wrong for rare shapes such as `if (x) /re/.test(y)`.
// A wrong guess can hide or invent tokens until the lexer next meets a quote or newline, so callers must treat
// results as "very likely" rather than proven. The test file lists the shapes that are covered.

export type TokenKind = 'ident' | 'number' | 'string' | 'template' | 'regex' | 'punct';

export interface Token {
  kind: TokenKind;
  /** The source text of the token. A template literal with `${}` parts comes out as several `template` tokens, one per text segment. */
  text: string;
  start: number;
  end: number;
  /** Curly-brace nesting at the token, counting `${` of template literals. A `{` and its `}` share a depth. */
  depth: number;
  /** A line break lies between the previous token and this one (needed to apply automatic semicolon insertion). */
  newlineBefore: boolean;
}

export interface LexResult {
  tokens: Token[];
  /** Offset where scanning stopped: the end of the source, or the unmatched `}` when `stopAtCloseBrace` is set. */
  end: number;
}

// After one of these a `/` starts a regular expression; after any other identifier it is division.
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdentStart = (c: number): boolean =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || (c > 127 && /[\p{L}\p{Nl}]/u.test(String.fromCharCode(c)));
const isIdentPart = (c: number): boolean => isIdentStart(c) || isDigit(c) || c === 0x200c || c === 0x200d || (c > 127 && /[\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u.test(String.fromCharCode(c)));

/** The words after which a `/` begins a regular expression, exported for callers that apply the same rule. */
export const isOperatorWord = (word: string): boolean => REGEX_AFTER_WORD.has(word);

/**
 * Tokenise `src` from `from`. With `stopAtCloseBrace` it stops at the first `}` that has no opening `{` in the scanned
 * text (used for `{expression}` in Svelte markup and for `${...}` in template literals), and `end` points at it.
 */
export function lexJs(src: string, from = 0, options: { stopAtCloseBrace?: boolean; depth?: number } = {}): LexResult {
  const tokens: Token[] = [];
  const n = src.length;
  const baseDepth = options.depth ?? 0;
  let depth = baseDepth;
  let i = from;
  let newline = false;
  /** The previous token for the regex-or-division decision; template pieces count even though they are separate tokens. */
  let last: Token | undefined;

  const push = (kind: TokenKind, start: number, end: number, tokenDepth = depth): Token => {
    const t: Token = { kind, text: src.slice(start, end), start, end, depth: tokenDepth, newlineBefore: newline };
    tokens.push(t);
    newline = false;
    last = t;
    return t;
  };

  const slashIsRegex = (): boolean => {
    if (!last) return true;
    switch (last.kind) {
      case 'number': case 'string': case 'template': case 'regex': return false;
      case 'ident': return REGEX_AFTER_WORD.has(last.text);
      default: return !(last.text === ')' || last.text === ']' || last.text === '}' || last.text === '++' || last.text === '--');
    }
  };

  /** Scan a regular expression starting at `i` (a `/`). Returns its end offset, or -1 when the line ends first. */
  const regexEnd = (start: number): number => {
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === '\n' || c === '\r') return -1;
      if (c === '\\') j += 2;
      else {
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          j += 1;
          while (j < n && isIdentPart(src.charCodeAt(j))) j += 1; // flags
          return j;
        }
        j += 1;
      }
    }
    return -1;
  };

  while (i < n) {
    const ch = src[i] as string;
    const code = src.charCodeAt(i);

    if (ch === '\n' || ch === '\r') { newline = true; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v' || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029) { i += 1; continue; }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? n : close + 2;
      if (/[\n\r]/.test(src.slice(i, stop))) newline = true; // a comment holding a line break counts as one
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push('string', i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }

    if (ch === '`') {
      // Text segments are tokens of their own and every `${ ... }` is lexed as code between them.
      let segStart = i;
      let j = i + 1;
      for (;;) {
        if (j >= n) { push('template', segStart, n); i = n; break; }
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '`') { push('template', segStart, j + 1); i = j + 1; break; }
        if (c === '$' && src[j + 1] === '{') {
          push('template', segStart, j + 2);
          const inner = lexJs(src, j + 2, { stopAtCloseBrace: true, depth: depth + 1 });
          tokens.push(...inner.tokens);
          if (inner.tokens.length > 0) { last = inner.tokens[inner.tokens.length - 1]; newline = false; }
          j = inner.end + 1; // past the closing `}`
          segStart = inner.end;
          continue;
        }
        j += 1;
      }
      continue;
    }

    if (isIdentStart(code)) {
      let j = i + 1;
      while (j < n && isIdentPart(src.charCodeAt(j))) j += 1;
      push('ident', i, j);
      i = j;
      continue;
    }

    // `...` must be one token: three separate dots would make `...rest` look like a member access `.rest`.
    if (ch === '.' && src[i + 1] === '.' && src[i + 2] === '.') { push('punct', i, i + 3); i += 3; continue; }

    if (isDigit(code) || (ch === '.' && isDigit(src.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && (isIdentPart(src.charCodeAt(j)) || src[j] === '.')) j += 1;
      push('number', i, j);
      i = j;
      continue;
    }

    if (ch === '/' && slashIsRegex()) {
      const end = regexEnd(i);
      if (end > 0) {
        push('regex', i, end);
        i = end;
        continue;
      }
    }

    if (ch === '{') { push('punct', i, i + 1); depth += 1; i += 1; continue; }
    if (ch === '}') {
      if (depth === baseDepth && options.stopAtCloseBrace) return { tokens, end: i };
      depth = Math.max(baseDepth, depth - 1);
      push('punct', i, i + 1);
      i += 1;
      continue;
    }
    if ((ch === '+' || ch === '-') && src[i + 1] === ch) { push('punct', i, i + 2); i += 2; continue; }
    push('punct', i, i + 1);
    i += 1;
  }
  return { tokens, end: n };
}

/** The value of a terminated string token, without escape handling (module specifiers and attribute names have none). */
export const stringValue = (t: Token): string => t.text.slice(1, -1);
