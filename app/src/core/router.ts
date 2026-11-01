// Hash router core (ADR 0001): seven screens, three levels at most, no library.
// Pure functions only, so it is tested without a browser.

export type Route =
  | { name: 'home' }
  | { name: 'map'; map: string }
  /** `zone` narrows the session to one zone of the map (`#/session/de_mirage?zone=a-site`). */
  | { name: 'session'; map: string; zone?: string | undefined }
  | { name: 'study'; map: string }
  | { name: 'summary'; map: string }
  | { name: 'primer' }
  | { name: 'progress' }
  | { name: 'settings' }
  /** The dev-only Callout Editor (SCOPE §8.3): a map picker, or one map. Development builds only. */
  | { name: 'editor'; map: string | null }
  | { name: 'not-found'; hash: string };

const MAP_ID = /^[a-z0-9_]+$/;

const ZONE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseHash(hash: string): Route {
  const [rawPath = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  const path = rawPath.replace(/\/+$/, '');
  if (path === '') return { name: 'home' };
  const parts = path.split('/');
  const [head, map, ...rest] = parts;
  if (head === 'primer' && parts.length === 1) return { name: 'primer' };
  if (head === 'progress' && parts.length === 1) return { name: 'progress' };
  if (head === 'settings' && parts.length === 1) return { name: 'settings' };
  if (head === 'editor' && parts.length === 1) return { name: 'editor', map: null };
  if (head === 'editor' && map !== undefined && MAP_ID.test(map) && rest.length === 0) return { name: 'editor', map };
  if (map !== undefined && MAP_ID.test(map) && rest.length === 0) {
    if (head === 'session') {
      const zone = new URLSearchParams(query).get('zone');
      return zone !== null && ZONE_ID.test(zone) ? { name: 'session', map, zone } : { name: 'session', map };
    }
    if (head === 'map' || head === 'study' || head === 'summary') return { name: head, map };
  }
  return { name: 'not-found', hash };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'session':
      return route.zone ? `#/session/${route.map}?zone=${route.zone}` : `#/session/${route.map}`;
    case 'map':
    case 'study':
    case 'summary':
      return `#/${route.name}/${route.map}`;
    case 'primer':
    case 'progress':
    case 'settings':
      return `#/${route.name}`;
    case 'editor':
      return route.map === null ? '#/editor' : `#/editor/${route.map}`;
    case 'not-found':
      return route.hash;
  }
}
