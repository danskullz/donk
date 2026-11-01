// The key map shown in Settings → Keys is plain data. These checks keep it a usable list: nothing empty, nothing twice,
// and the keys the screens are documented to answer to are all there.

import { describe, expect, it } from 'vitest';
import { KEYMAP } from './keymap';

const all = KEYMAP.flatMap((g) => g.rows.map((r) => ({ group: g.id, ...r })));

describe('the key map', () => {
  it('has groups with unique ids and titles, each with rows', () => {
    expect(new Set(KEYMAP.map((g) => g.id)).size).toBe(KEYMAP.length);
    expect(new Set(KEYMAP.map((g) => g.title)).size).toBe(KEYMAP.length);
    for (const g of KEYMAP) expect(g.rows.length, g.id).toBeGreaterThan(0);
  });

  it('names every key and every action, with no action twice in a group (the screen keys rows by it)', () => {
    for (const row of all) {
      expect(row.keys.length, row.does).toBeGreaterThan(0);
      expect(row.keys.every((k) => k.trim() !== ''), row.does).toBe(true);
      expect(row.does.trim(), row.group).not.toBe('');
    }
    for (const g of KEYMAP) expect(new Set(g.rows.map((r) => r.does)).size, g.id).toBe(g.rows.length);
  });

  it('keeps each line short enough for a phone', () => {
    for (const row of all) expect(row.does.length, row.does).toBeLessThanOrEqual(34);
  });

  it('covers the session keys of SCOPE §5.4: 1–4, Enter, Space, H, S, Esc', () => {
    const session = new Set(KEYMAP.find((g) => g.id === 'session')?.rows.flatMap((r) => r.keys));
    for (const key of ['1–4', 'Enter', 'Space', 'H', 'S', 'Esc']) expect(session.has(key), key).toBe(true);
  });

  it('covers the map keys: arrows between regions, zoom, fit, choose', () => {
    const map = new Set(KEYMAP.find((g) => g.id === 'map')?.rows.flatMap((r) => r.keys));
    for (const key of ['←', '→', '↑', '↓', '+', '-', '0', 'Tab', 'Enter']) expect(map.has(key), key).toBe(true);
  });

  it('says how to move between tabs and leave settings', () => {
    const settings = new Set(KEYMAP.find((g) => g.id === 'settings')?.rows.flatMap((r) => r.keys));
    for (const key of ['←', '→', 'Esc']) expect(settings.has(key), key).toBe(true);
  });
});
