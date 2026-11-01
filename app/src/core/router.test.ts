import { describe, expect, it } from 'vitest';
import { parseHash, toHash, type Route } from './router';

describe('parseHash', () => {
  it('treats an empty hash as home', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  it('reads map-level screens', () => {
    expect(parseHash('#/map/de_mirage')).toEqual({ name: 'map', map: 'de_mirage' });
    expect(parseHash('#/session/de_mirage/')).toEqual({ name: 'session', map: 'de_mirage' });
    expect(parseHash('#/summary/de_mirage')).toEqual({ name: 'summary', map: 'de_mirage' });
  });

  it('reads the study screen and a session narrowed to one zone', () => {
    expect(parseHash('#/study/de_mirage')).toEqual({ name: 'study', map: 'de_mirage' });
    expect(parseHash('#/session/de_mirage?zone=a-site')).toEqual({ name: 'session', map: 'de_mirage', zone: 'a-site' });
    expect(parseHash('#/session/de_mirage?zone=Not%20A%20Zone')).toEqual({ name: 'session', map: 'de_mirage' });
    expect(parseHash('#/session/de_mirage?other=1')).toEqual({ name: 'session', map: 'de_mirage' });
  });

  it('reads top-level screens', () => {
    expect(parseHash('#/progress')).toEqual({ name: 'progress' });
    expect(parseHash('#/primer')).toEqual({ name: 'primer' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });

  it('reads the editor, with or without a map', () => {
    expect(parseHash('#/editor')).toEqual({ name: 'editor', map: null });
    expect(parseHash('#/editor/de_mirage')).toEqual({ name: 'editor', map: 'de_mirage' });
    expect(parseHash('#/editor/de_mirage/x')).toEqual({ name: 'not-found', hash: '#/editor/de_mirage/x' });
    expect(parseHash('#/editor/De Mirage')).toEqual({ name: 'not-found', hash: '#/editor/De Mirage' });
  });

  it('rejects unknown paths, extra segments and odd map ids', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'not-found', hash: '#/nope' });
    expect(parseHash('#/map')).toEqual({ name: 'not-found', hash: '#/map' });
    expect(parseHash('#/map/de_mirage/extra')).toEqual({ name: 'not-found', hash: '#/map/de_mirage/extra' });
    expect(parseHash('#/map/De Mirage')).toEqual({ name: 'not-found', hash: '#/map/De Mirage' });
    expect(parseHash('#/progress/extra')).toEqual({ name: 'not-found', hash: '#/progress/extra' });
  });
});

describe('toHash', () => {
  it('round-trips every real route', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'map', map: 'de_mirage' },
      { name: 'session', map: 'de_mirage' },
      { name: 'summary', map: 'de_mirage' },
      { name: 'study', map: 'de_mirage' },
      { name: 'session', map: 'de_mirage', zone: 'a-site' },
      { name: 'primer' },
      { name: 'progress' },
      { name: 'settings' },
      { name: 'editor', map: null },
      { name: 'editor', map: 'de_mirage' },
    ];
    for (const route of routes) expect(parseHash(toHash(route))).toEqual(route);
  });
});
