import { describe, expect, it } from 'vitest';
import { MODE_LABEL, motionReduced, plural, seconds } from './helpers';
import { MODES } from '../../core/types';

describe('motionReduced', () => {
  it('follows the browser when the setting is "system"', () => {
    expect(motionReduced('system', true)).toBe(true);
    expect(motionReduced('system', false)).toBe(false);
  });

  it('lets the learner override the browser either way', () => {
    expect(motionReduced('on', false)).toBe(true);
    expect(motionReduced('on', true)).toBe(true);
    expect(motionReduced('off', true)).toBe(false);
    expect(motionReduced('off', false)).toBe(false);
  });
});

describe('labels and numbers', () => {
  it('every mode has a name to show, Speed call included', () => {
    expect(Object.keys(MODE_LABEL).sort()).toEqual([...MODES].sort());
    expect(MODE_LABEL.speed).toBe('Speed call');
  });

  it('shows seconds to a tenth', () => {
    expect(seconds(1234)).toBe('1.2 s');
    expect(seconds(0)).toBe('0.0 s');
  });

  it('pluralises', () => {
    expect(plural(1, 'time')).toBe('1 time');
    expect(plural(2, 'time')).toBe('2 times');
    expect(plural(0, 'box', 'boxes')).toBe('0 boxes');
  });
});
