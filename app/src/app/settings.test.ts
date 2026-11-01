// The learner's preferences (app/settings.ts): what is kept, what is refused, what survives a damaged file, and what
// reaches the page. Storage is a plain object standing in for localStorage; `document` and `matchMedia` are stubbed
// only where a test needs them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  hardModeFor,
  motionAttribute,
  motionReduced,
  resetSettings,
  SESSION_LENGTHS,
  sessionLengthOf,
  SETTINGS_KEY,
  settingsFromBackup,
  SettingsSchema,
  subscribeSettings,
  updateSettings,
  useSettingsStorage,
} from './settings';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  useSettingsStorage(store);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSettingsStorage(null);
});

describe('defaults and changes', () => {
  it('starts with the documented defaults', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ sessionCards: 20, sessionMinutes: null, newPerSession: 4, retention: 0.9, naming: 'both', gentleStart: true, sound: false, reducedMotion: 'system', primerSeen: false, hardModeDefault: false });
  });

  it('merges a change, keeps it and tells subscribers', () => {
    const seen: string[] = [];
    const off = subscribeSettings((s) => seen.push(s.naming));
    updateSettings({ naming: 'game' });
    updateSettings({ gentleStart: false });
    off();
    updateSettings({ naming: 'community' });
    expect(seen).toEqual(['game', 'game']);
    expect(getSettings()).toMatchObject({ naming: 'community', gentleStart: false });
    expect(JSON.parse(store.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ naming: 'community', gentleStart: false });
  });

  it('refuses a value outside its range as a whole, and says nothing else changed', () => {
    updateSettings({ newPerSession: 6 });
    const before = getSettings();
    for (const bad of [{ newPerSession: 9 }, { newPerSession: 0 }, { newPerSession: 2.5 }, { retention: 0.84 }, { retention: 0.96 }, { sessionCards: 3 }, { sessionMinutes: 0 }, { naming: 'klingon' as never }]) {
      expect(updateSettings({ ...bad, gentleStart: false }), JSON.stringify(bad)).toBe(before);
    }
    expect(getSettings()).toEqual(before);
    expect(getSettings().gentleStart).toBe(true);
  });

  it('accepts the limits of every range', () => {
    for (const patch of [{ newPerSession: 1 }, { newPerSession: 8 }, { retention: 0.85 }, { retention: 0.95 }, { sessionCards: null }, { sessionCards: 5 }, { sessionMinutes: 60 }]) {
      expect(updateSettings(patch), JSON.stringify(patch)).toMatchObject(patch);
    }
  });

  it('follows the default Hard mode unless a map has its own', () => {
    updateSettings({ hardModeDefault: true });
    expect(hardModeFor(getSettings(), 'de_mirage')).toBe(true);
    updateSettings({ hardMode: { de_mirage: false } });
    expect(hardModeFor(getSettings(), 'de_mirage')).toBe(false);
    expect(hardModeFor(getSettings(), 'de_nuke')).toBe(true);
  });
});

describe('reset', () => {
  it('puts every preference back', () => {
    updateSettings({ naming: 'game', newPerSession: 7, retention: 0.95, hardMode: { de_mirage: true }, sound: true, reducedMotion: 'on', sessionCards: null, sessionMinutes: 10 });
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(store.getItem(SETTINGS_KEY) ?? '{}')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the note that the primer was seen: tidying settings must not send anyone back through the intro', () => {
    updateSettings({ primerSeen: true, naming: 'game' });
    resetSettings();
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, primerSeen: true });
  });

  it('tells subscribers', () => {
    const seen: unknown[] = [];
    subscribeSettings((s) => seen.push(s.newPerSession));
    updateSettings({ newPerSession: 2 });
    resetSettings();
    expect(seen).toEqual([2, 4]);
  });
});

describe('session length', () => {
  it('offers 5 min, 10 min, 20 cards and until I stop, each a valid change', () => {
    expect(SESSION_LENGTHS.map((l) => l.label)).toEqual(['5 min', '10 min', '20 cards', 'Until I stop']);
    for (const l of SESSION_LENGTHS) {
      updateSettings(l.patch);
      expect(sessionLengthOf(getSettings()), l.id).toBe(l.id);
    }
  });

  it('maps the choices onto the two stored limits', () => {
    expect(SESSION_LENGTHS.find((l) => l.id === 'min5')?.patch).toEqual({ sessionMinutes: 5, sessionCards: null });
    expect(SESSION_LENGTHS.find((l) => l.id === 'cards20')?.patch).toEqual({ sessionMinutes: null, sessionCards: 20 });
    expect(SESSION_LENGTHS.find((l) => l.id === 'open')?.patch).toEqual({ sessionMinutes: null, sessionCards: null });
  });

  it('recognises no choice for a combination the screen does not offer', () => {
    expect(sessionLengthOf({ sessionMinutes: 7, sessionCards: null })).toBeNull();
    expect(sessionLengthOf({ sessionMinutes: 5, sessionCards: 20 })).toBeNull();
    expect(sessionLengthOf({ sessionMinutes: null, sessionCards: 50 })).toBeNull();
  });
});

describe('what is kept between visits', () => {
  it('reads back what was written', () => {
    updateSettings({ naming: 'game', newPerSession: 6, hardMode: { de_test: true } });
    useSettingsStorage(store); // a new page reading the same storage
    expect(getSettings()).toMatchObject({ naming: 'game', newPerSession: 6, hardMode: { de_test: true } });
  });

  it('uses the defaults for storage that is empty, not JSON, or the wrong shape', () => {
    for (const raw of [null, '', 'not json', '[]', '42', 'null', '"x"']) {
      store.data.clear();
      if (raw !== null) store.setItem(SETTINGS_KEY, raw);
      useSettingsStorage(store);
      expect(getSettings(), String(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps the good fields when one is out of range or unknown, instead of dropping them all', () => {
    store.setItem(SETTINGS_KEY, JSON.stringify({ naming: 'game', newPerSession: 99, retention: 0.93, fromTheFuture: true, sound: 'yes' }));
    useSettingsStorage(store);
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, naming: 'game', retention: 0.93 });
  });

  it('fills a field an older version did not have', () => {
    store.setItem(SETTINGS_KEY, JSON.stringify({ naming: 'community' }));
    useSettingsStorage(store);
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, naming: 'community' });
  });

  it('works with no storage at all, for the life of the page', () => {
    useSettingsStorage(null);
    updateSettings({ naming: 'game' });
    expect(getSettings().naming).toBe('game');
  });

  it('survives storage that refuses to write', () => {
    useSettingsStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    });
    expect(updateSettings({ naming: 'game' }).naming).toBe('game');
  });
});

describe('motion', () => {
  it('writes what the stylesheet reads', () => {
    expect(motionAttribute('system')).toBe('system');
    expect(motionAttribute('on')).toBe('reduce');
    expect(motionAttribute('off')).toBe('full');
  });

  it('puts it on the page element when a setting changes and when storage is read', () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal('document', { documentElement: { dataset } });
    updateSettings({ reducedMotion: 'on' });
    expect(dataset['motion']).toBe('reduce');
    updateSettings({ reducedMotion: 'off' });
    expect(dataset['motion']).toBe('full');
    resetSettings();
    expect(dataset['motion']).toBe('system');
    store.setItem(SETTINGS_KEY, JSON.stringify({ reducedMotion: 'on' }));
    useSettingsStorage(store);
    expect(dataset['motion']).toBe('reduce');
  });

  it('answers "reduce?" for code that animates in script: the override wins, "system" asks the device', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion: reduce') }));
    expect(motionReduced({ reducedMotion: 'system' })).toBe(true);
    expect(motionReduced({ reducedMotion: 'on' })).toBe(true);
    expect(motionReduced({ reducedMotion: 'off' })).toBe(false); // "full" beats a device that asks for less
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(motionReduced({ reducedMotion: 'system' })).toBe(false);
    expect(motionReduced({ reducedMotion: 'on' })).toBe(true);
  });

  it('reads the current setting when none is given, and is false where there is no media query', () => {
    expect(motionReduced()).toBe(false);
    updateSettings({ reducedMotion: 'on' });
    expect(motionReduced()).toBe(true);
  });
});

describe('settings from a backup file', () => {
  it('takes every valid field and names the ones it refused', () => {
    const { patch, rejected } = settingsFromBackup({ naming: 'game', newPerSession: 12, retention: 0.88, sound: 'loud', hardMode: { de_mirage: true }, unknownSetting: 1 });
    expect(patch).toEqual({ naming: 'game', retention: 0.88, hardMode: { de_mirage: true } });
    expect(rejected.sort()).toEqual(['newPerSession', 'sound']);
  });

  it('ignores a field a newer version added, without a word', () => {
    expect(settingsFromBackup({ fromTheFuture: { deep: true } })).toEqual({ patch: {}, rejected: [] });
  });

  it('refuses a settings value that is not an object', () => {
    for (const raw of [null, undefined, 'x', 3, [], [{ naming: 'game' }]]) {
      expect(settingsFromBackup(raw), String(raw)).toEqual({ patch: {}, rejected: ['settings'] });
    }
  });

  it('gives a patch the app can apply as it is', () => {
    const { patch } = settingsFromBackup({ ...DEFAULT_SETTINGS, naming: 'community', sessionCards: null, sessionMinutes: 10 });
    expect(updateSettings(patch)).toMatchObject({ naming: 'community', sessionCards: null, sessionMinutes: 10 });
  });

  it('round-trips everything a settings object holds', () => {
    const all = SettingsSchema.parse({ naming: 'game', hardMode: { de_a: true }, retention: 0.92, reducedMotion: 'off', primerSeen: true });
    expect(settingsFromBackup(JSON.parse(JSON.stringify(all)))).toEqual({ patch: all, rejected: [] });
  });

  it('does not run anything from a hostile file', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"naming":"game","hardMode":{"__proto__":{"x":1}}}') as unknown;
    const { patch } = settingsFromBackup(hostile);
    expect(patch).toMatchObject({ naming: 'game' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });
});
