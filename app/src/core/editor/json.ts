// How the Editor writes JSON into /data: two-space indent like the files already there, but short arrays of numbers
// (points, polygons, id lists) and small objects stay on one line, so a region is a column of points and a diff shows
// what changed rather than the whole file reflowed.

const isNum = (v: unknown): v is number => typeof v === 'number';
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`;
  }
  return JSON.stringify(v);
}

const isSmallObject = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const values = Object.values(v as Record<string, unknown>).filter((x) => x !== undefined);
  return values.length <= 3 && values.every(isPrimitive) && inline(v).length <= 70;
};

function format(v: unknown, depth: number): string {
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isNum)) return inline(v);
    if (v.every(isStr)) {
      const one = inline(v);
      if (one.length <= 90) return one;
    }
    if (v.length === 1 && isSmallObject(v[0])) return `[${inline(v[0])}]`;
    if (v.every((x) => Array.isArray(x) && x.every(isNum)) || v.every(isSmallObject)) {
      return `[\n${v.map((x) => `${pad}${inline(x)}`).join(',\n')}\n${end}]`;
    }
    return `[\n${v.map((x) => `${pad}${format(x, depth + 1)}`).join(',\n')}\n${end}]`;
  }
  if (v !== null && typeof v === 'object') {
    if (depth > 0 && isSmallObject(v)) return inline(v);
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${format(x, depth + 1)}`).join(',\n')}\n${end}}`;
  }
  return JSON.stringify(v);
}

/** JSON text for a data file, ending in a newline. */
export function stableJson(value: unknown): string {
  return `${format(value, 0)}\n`;
}
