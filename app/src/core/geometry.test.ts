import { describe, expect, it } from 'vitest';
import {
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonWithin,
  smallestRegionAt,
  type Polygon,
} from './geometry';

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const small: Polygon = [[2, 2], [4, 2], [4, 4], [2, 4]];
const lShape: Polygon = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
const bowtie: Polygon = [[0, 0], [10, 10], [10, 0], [0, 10]];

describe('area, centroid, bounds', () => {
  it('computes the area of a square and an L', () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea(lShape)).toBe(64);
  });
  it('is orientation independent', () => {
    expect(polygonArea([...square].reverse())).toBe(100);
  });
  it('finds the centroid of a square', () => {
    expect(polygonCentroid(square)).toEqual([5, 5]);
  });
  it('falls back to the vertex mean when the polygon has no area', () => {
    expect(polygonCentroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0]);
  });
  it('reports bounds', () => {
    expect(polygonBounds(lShape)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe('pointInPolygon', () => {
  it('handles inside, outside and the concave notch of an L', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([11, 5], square)).toBe(false);
    expect(pointInPolygon([2, 8], lShape)).toBe(true);
    expect(pointInPolygon([8, 8], lShape)).toBe(false);
  });
  it('counts the boundary and the vertices as inside', () => {
    expect(pointInPolygon([10, 5], square)).toBe(true);
    expect(pointInPolygon([0, 0], square)).toBe(true);
    expect(pointInPolygon([5, 0], square)).toBe(true);
  });
});

describe('isSimplePolygon', () => {
  it('accepts convex and concave polygons', () => {
    expect(isSimplePolygon(square)).toBe(true);
    expect(isSimplePolygon(lShape)).toBe(true);
  });
  it('rejects a bow-tie', () => {
    expect(isSimplePolygon(bowtie)).toBe(false);
  });
  it('rejects fewer than three points', () => {
    expect(isSimplePolygon([[0, 0], [1, 1]])).toBe(false);
  });
  it('rejects an edge that folds back over its neighbour', () => {
    expect(isSimplePolygon([[0, 0], [10, 0], [5, 0], [5, 5]])).toBe(false);
  });
  it('rejects a vertex touching a non-adjacent edge', () => {
    expect(isSimplePolygon([[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]])).toBe(false);
  });
});

describe('nesting', () => {
  it('knows when one polygon sits inside another', () => {
    expect(polygonWithin(small, square)).toBe(true);
    expect(polygonWithin(square, small)).toBe(false);
  });
  it('lets the smallest region under the pointer win', () => {
    const regions = [
      { id: 'parent', polygon: square },
      { id: 'spot', polygon: small },
    ];
    expect(smallestRegionAt([3, 3], regions)?.id).toBe('spot');
    expect(smallestRegionAt([8, 8], regions)?.id).toBe('parent');
    expect(smallestRegionAt([20, 20], regions)).toBeNull();
  });
});
