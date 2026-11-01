// The synthetic development map (see app/data.ts). Screenshots are generated pictures: coloured blocks and a plate
// number, never the callout's name, so a question cannot be answered by reading the image. Not in production builds.

import type { MapData } from '../app/data';
import { mulberry32 } from '../core/rng';
import { makeCallouts, makeMap } from '../core/test-fixtures';

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A 16:9 picture that is the same for the same file name and different for different ones. */
export function demoShotUrl(file: string): string {
  const h = hash(file);
  const rnd = mulberry32(h);
  const hue = h % 360;
  const blocks = Array.from({ length: 4 + Math.floor(rnd() * 3) }, () => {
    const w = 160 + rnd() * 420;
    const bh = 140 + rnd() * 420;
    const x = rnd() * (1600 - w);
    return `<rect x="${x.toFixed(0)}" y="${(560 - bh).toFixed(0)}" width="${w.toFixed(0)}" height="${bh.toFixed(0)}" fill="hsl(${(hue + rnd() * 70) % 360} ${18 + rnd() * 14}% ${28 + rnd() * 20}%)"/>`;
  }).join('');
  const arch = `<path d="M${(300 + rnd() * 600).toFixed(0)} 560v-${(160 + rnd() * 120).toFixed(0)}a${(90 + rnd() * 70).toFixed(0)} ${(90 + rnd() * 70).toFixed(0)} 0 0 1 ${(180 + rnd() * 140).toFixed(0)} 0v${(160).toFixed(0)}z" fill="hsl(${hue} 20% 10%)"/>`;
  const plate = String(h % 90).padStart(2, '0');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 22% 26%)"/><stop offset="1" stop-color="hsl(${hue} 18% 15%)"/></linearGradient></defs>` +
    `<rect width="1600" height="900" fill="url(#g)"/><rect y="560" width="1600" height="340" fill="hsl(${(hue + 30) % 360} 14% 12%)"/>` +
    `${blocks}${arch}<text x="48" y="860" font-family="monospace" font-size="44" fill="#9a9da1">demo plate ${plate}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function demoMapData(): MapData {
  return { map: makeMap(), callouts: makeCallouts(), shotUrl: demoShotUrl, demo: true, art: null };
}
