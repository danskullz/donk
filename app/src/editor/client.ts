// The Editor's side of the dev-server plugin (tools/editor-plugin.ts): load a map's files and the nav mesh, save the
// document. Everything that comes back is parsed with the same schemas the content check uses.

import { toWork, exportDoc, WorkFileSchema, type EditorDoc, type WorkFile } from '../core/editor/doc';
import { NavMeshSchema, type NavMesh } from '../core/editor/nav';
import { captureManifest } from '../core/editor/shotplan';
import { CalloutsFileSchema, MapSchema, type Callout, type MapRecord } from '../core/schema';

const BASE = '/__editor';

/** The files changed on disk after this tab loaded them. */
export class ConflictError extends Error {}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // not JSON: leave it null and report by status
  }
  if (!res.ok) {
    const message = (body as { error?: string; detail?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    const detail = (body as { detail?: string } | null)?.detail;
    if (res.status === 409) throw new ConflictError(message);
    throw new Error(detail ? `${message}: ${detail}` : message);
  }
  return body;
}

export interface MapListing {
  id: string;
  displayName: string;
  pool: 'active-duty' | 'extra';
  available: boolean;
  hasNav: boolean;
  hasData: boolean;
}

export async function listMaps(): Promise<MapListing[]> {
  return (await request('/maps')) as MapListing[];
}

export interface LoadedMap {
  etag: string;
  map: MapRecord;
  callouts: Callout[];
  work: WorkFile | null;
  hasNav: boolean;
  radars: string[];
}

export async function loadMap(id: string): Promise<LoadedMap> {
  const raw = (await request(`/map/${id}`)) as { etag: string; map: unknown; callouts: unknown; work: unknown; hasNav: boolean; radars: string[] };
  const map = MapSchema.safeParse(raw.map);
  if (!map.success) throw new Error(`data/maps/${id}.json is not valid: ${map.error.issues[0]?.path.join('.')} ${map.error.issues[0]?.message}`);
  const callouts = CalloutsFileSchema.safeParse(raw.callouts);
  if (!callouts.success) throw new Error(`data/callouts/${id}.json is not valid: ${callouts.error.issues[0]?.path.join('.')} ${callouts.error.issues[0]?.message}`);
  let work: WorkFile | null = null;
  if (raw.work !== null) {
    const parsed = WorkFileSchema.safeParse(raw.work);
    if (!parsed.success) throw new Error(`data/editor/${id}.work.json is not valid: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
    work = parsed.data;
  }
  return { etag: raw.etag, map: map.data, callouts: callouts.data, work, hasNav: raw.hasNav, radars: raw.radars };
}

export async function loadNav(id: string): Promise<NavMesh> {
  const res = await fetch(`${BASE}/nav/${id}`);
  if (!res.ok) throw new Error(`no nav mesh for ${id} (assets/valve/nav/${id}.json)`);
  const parsed = NavMeshSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`the nav mesh for ${id} is not valid: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export const radarUrl = (name: string): string => `${BASE}/radar/${name}`;

/** Write the document. Returns the new etag. */
export async function saveMap(id: string, etag: string, doc: EditorDoc): Promise<string> {
  const out = exportDoc(doc);
  const body = { etag, map: out.map, callouts: out.callouts, work: toWork(doc), manifest: captureManifest(doc) };
  const result = (await request(`/map/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-editor': '1' }, body: JSON.stringify(body) })) as { etag: string };
  return result.etag;
}
