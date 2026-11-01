import { describe, expect, it } from 'vitest';
import { lexJs, stringValue } from './js-lex';

const words = (src: string): string[] => lexJs(src).tokens.map((t) => `${t.kind}:${t.text}`);
const code = (src: string): string[] => lexJs(src).tokens.filter((t) => t.kind === 'ident').map((t) => t.text);

describe('lexJs: code versus text', () => {
  it('skips line and block comments', () => {
    expect(code('a // b c\nd /* e\nf */ g')).toEqual(['a', 'd', 'g']);
  });

  it('keeps strings whole, with escaped quotes', () => {
    expect(words(`x = 'it\\'s' + "a \\" b"`)).toEqual(['ident:x', 'punct:=', "string:'it\\'s'", 'punct:+', 'string:"a \\" b"']);
    expect(code(`'import x from "y"'`)).toEqual([]);
  });

  it('treats template text as text and ${} parts as code', () => {
    expect(code('`a b ${c + d} e ${f}`')).toEqual(['c', 'd', 'f']);
  });

  it('handles nested templates and braces inside ${}', () => {
    expect(code('`${ {a: `${b}`}.a }` after')).toEqual(['a', 'b', 'a', 'after']);
  });

  it('marks tokens that follow a line break, including through a multi-line comment', () => {
    const t = lexJs('a\nb /*\n*/ c d').tokens;
    expect(t.map((x) => x.newlineBefore)).toEqual([false, true, true, false]);
  });
});

describe('lexJs: division versus regular expression', () => {
  it('reads a regex that holds quotes and slashes in a class', () => {
    // If this were read as division, the quote would start a string and swallow `real`.
    expect(code(`const re = /["'/]+/g; real`)).toEqual(['const', 're', 'real']);
  });

  it('reads division after a value as division', () => {
    expect(code('a / b / c')).toEqual(['a', 'b', 'c']);
    expect(code('(a) / 2 + b[0] / 3 + i++ / 4 + 5 / x')).toEqual(['a', 'b', 'i', 'x']);
  });

  it('reads a regex after an operator, a keyword or the start', () => {
    expect(code('x = /a b/.test(y)')).toEqual(['x', 'test', 'y']);
    expect(code('return /"/.test(s)')).toEqual(['return', 'test', 's']);
  });

  it('gives up on a slash that has no closing slash on its line', () => {
    expect(code('x = / y\nz')).toEqual(['x', 'y', 'z']);
  });
});

describe('lexJs: punctuation', () => {
  it('reads a spread as one token, so it is not mistaken for a member access', () => {
    expect(words('f(...rest, a.b, ...[c])')).toEqual([
      'ident:f', 'punct:(', 'punct:...', 'ident:rest', 'punct:,', 'ident:a', 'punct:.', 'ident:b', 'punct:,', 'punct:...', 'punct:[', 'ident:c', 'punct:]', 'punct:)',
    ]);
  });

  it('reads ++ and -- as one token so a following slash is division', () => {
    expect(code('i++ / 2 + j-- / 3')).toEqual(['i', 'j']);
  });
});

describe('lexJs: braces and depth', () => {
  it('records brace depth, pairing { with its }', () => {
    const depths = lexJs('a { b { c } d } e').tokens.map((t) => `${t.text}${t.depth}`);
    expect(depths).toEqual(['a0', '{0', 'b1', '{1', 'c2', '}1', 'd1', '}0', 'e0']);
  });

  it('stops at an unmatched } when asked, and reports where', () => {
    const src = 'a + {b: 1}.b } tail';
    const r = lexJs(src, 0, { stopAtCloseBrace: true });
    expect(src.slice(r.end)).toBe('} tail');
    expect(r.tokens.some((t) => t.text === 'tail')).toBe(false);
  });

  it('does not stop at a } inside a string or a template', () => {
    const src = `a + "}" + \`}\` + b } tail`;
    const r = lexJs(src, 0, { stopAtCloseBrace: true });
    expect(src.slice(r.end)).toBe('} tail');
    expect(r.tokens.map((t) => t.text)).toContain('b');
  });
});

describe('stringValue', () => {
  it('strips the quotes', () => {
    const t = lexJs(`"./a.js"`).tokens[0];
    expect(t && stringValue(t)).toBe('./a.js');
  });
});
