// Learner preferences (SCOPE.md §5.8). Small, synchronous and kept in localStorage: they are not learning history
// (that is the review log in IndexedDB), and a lost settings file costs a minute, not a month. Plain TypeScript so
// every screen and the session starter read the same values; Svelte screens wrap it in their own $state.
//
// This is the contract other code is written against. The Settings screen and storage hardening extend it; keep the
// exported names and the shape of `AppSettings` stable, and add fields with defaults.
//
// Added for the Settings screen: the four session-length choices (they map onto `sessionMinutes` and `sessionCards`),
// reading settings out of a backup file field by field, and `data-motion` on <html> so the reduced-motion override
// reaches the CSS from every screen, not just from Settings.

import { z } from 'zod';

export const SettingsSchema = z.strictObject({
  /** Quiz cards per session. null means "until I stop" (SCOPE §4.3). */
  sessionCards: z.number().int().min(5).max(200).nullable().default(20),
  /** A time limit for a session in minutes, or null for none. Whichever limit comes first ends the session. */
  sessionMinutes: z.number().int().min(1).max(60).nullable().default(null),
  /** Callouts introduced per session (SCOPE §4.3). */
  newPerSession: z.number().int().min(1).max(8).default(4),
  /** Target recall at review time, 0.85 to 0.95 (SCOPE §4.4). */
  retention: z.number().min(0.85).max(0.95).default(0.9),
  /** Hard mode for maps that have no setting of their own (SCOPE §4.12). */
  hardModeDefault: z.boolean().default(false),
  /** Per-map Hard mode, by map id. */
  hardMode: z.record(z.string(), z.boolean()).default({}),
  /** Which names are shown and accepted (SCOPE §3.3): both, community only, or the game's own only. */
  naming: z.enum(['both', 'community', 'game']).default('both'),
  /** Three options instead of four on an item's first multiple-choice question (SCOPE §4.11). */
  gentleStart: z.boolean().default(true),
  sound: z.boolean().default(false),
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  /** The first-run primer has been seen or skipped (SCOPE §4.11, §5.5). */
  primerSeen: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({});

export const SETTINGS_KEY = 'callouts.settings';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let storage: StorageLike | null = (() => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked (private window, site data off): settings then last for the page's life
  }
})();

/** Tests and other hosts: where settings are kept, or null for memory only. */
export function useSettingsStorage(s: StorageLike | null): void {
  storage = s;
  current = read();
  reflect(current);
}

function read(): AppSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const whole = SettingsSchema.safeParse(parsed);
      if (whole.success) return whole.data;
      // One field that is out of range (a hand edit, a value from another version) must not reset the others.
      const salvaged = SettingsSchema.safeParse(settingsFromBackup(parsed).patch);
      if (salvaged.success) return salvaged.data;
    }
  } catch {
    // unreadable: fall through to the defaults
  }
  return DEFAULT_SETTINGS;
}

let current: AppSettings = read();
const listeners = new Set<(s: AppSettings) => void>();

/** The value of `data-motion` on <html> for a reduced-motion setting: global.css reads it. */
export function motionAttribute(setting: AppSettings['reducedMotion']): 'system' | 'reduce' | 'full' {
  return setting === 'on' ? 'reduce' : setting === 'off' ? 'full' : 'system';
}

/**
 * Whether motion should be reduced right now: the learner's override if there is one, else what the device asks for.
 * For code that animates in script (a timer drawn as a bar, a flash); stylesheets read `data-motion` instead.
 */
export function motionReduced(s: Pick<AppSettings, 'reducedMotion'> = current): boolean {
  if (s.reducedMotion !== 'system') return s.reducedMotion === 'on';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Put on <html> what the CSS needs to know. Safe where there is no document (unit tests). */
function reflect(s: AppSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['motion'] = motionAttribute(s.reducedMotion);
}
reflect(current);

function commit(next: AppSettings): AppSettings {
  current = next;
  reflect(next);
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // quota or blocked storage: keep the value for this page
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function getSettings(): AppSettings {
  return current;
}

/** Merge a change. Values outside the allowed range are refused as a whole (the previous settings stay). */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const parsed = SettingsSchema.safeParse({ ...current, ...patch });
  return parsed.success ? commit(parsed.data) : current;
}

/**
 * Every preference back to its default. `primerSeen` is kept: it records that the intro was shown, not a preference, and
 * clearing it would send the learner back through the first-run primer for having tidied their settings.
 */
export function resetSettings(): AppSettings {
  return commit({ ...DEFAULT_SETTINGS, primerSeen: current.primerSeen });
}

export function subscribeSettings(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hard mode for one map: its own setting if it has one, else the default. */
export function hardModeFor(s: AppSettings, mapId: string): boolean {
  return s.hardMode[mapId] ?? s.hardModeDefault;
}

// ---- session length (SCOPE §5.8): four choices over two stored fields ----

export type SessionLength = 'min5' | 'min10' | 'cards20' | 'open';

export const SESSION_LENGTHS: readonly { id: SessionLength; label: string; patch: Pick<AppSettings, 'sessionMinutes' | 'sessionCards'> }[] = [
  { id: 'min5', label: '5 min', patch: { sessionMinutes: 5, sessionCards: null } },
  { id: 'min10', label: '10 min', patch: { sessionMinutes: 10, sessionCards: null } },
  { id: 'cards20', label: '20 cards', patch: { sessionMinutes: null, sessionCards: 20 } },
  { id: 'open', label: 'Until I stop', patch: { sessionMinutes: null, sessionCards: null } },
];

/** The choice these settings amount to, or null for a combination the screen does not offer (a hand-edited value). */
export function sessionLengthOf(s: Pick<AppSettings, 'sessionMinutes' | 'sessionCards'>): SessionLength | null {
  return SESSION_LENGTHS.find((l) => l.patch.sessionMinutes === s.sessionMinutes && l.patch.sessionCards === s.sessionCards)?.id ?? null;
}

// ---- settings from a backup file ----

/**
 * The values of a backup's settings that are valid, field by field: one bad or unknown field (from a newer app, or a
 * hand-edited file) costs only itself. `rejected` names the fields that were not taken.
 */
export function settingsFromBackup(raw: unknown): { patch: Partial<AppSettings>; rejected: string[] } {
  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { patch, rejected: ['settings'] };
  const given = raw as Record<string, unknown>;
  for (const key of Object.keys(SettingsSchema.shape) as (keyof AppSettings)[]) {
    if (!Object.hasOwn(given, key)) continue;
    const parsed = SettingsSchema.shape[key].safeParse(given[key]);
    if (parsed.success) patch[key] = parsed.data;
    else rejected.push(key);
  }
  // Unknown keys are ignored without a word: they come from a newer version and have nowhere to go.
  return { patch: patch as Partial<AppSettings>, rejected };
}
