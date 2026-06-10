import { describe, it, expect } from 'vitest';
import { clampTrim } from './trim.js';

describe('clampTrim', () => {
  it('passes through valid trims, rounding to integers', () => {
    expect(clampTrim(100, 10.4, 20.6)).toEqual({ trimStart: 10, trimEnd: 21 });
  });

  it('floors negatives to zero', () => {
    expect(clampTrim(100, -5, -1)).toEqual({ trimStart: 0, trimEnd: 0 });
  });

  it('caps trimStart so at least 1px remains', () => {
    expect(clampTrim(100, 150, 0)).toEqual({ trimStart: 99, trimEnd: 0 });
  });

  it('caps trimEnd against an existing trimStart', () => {
    expect(clampTrim(100, 40, 80)).toEqual({ trimStart: 40, trimEnd: 59 });
  });
});
