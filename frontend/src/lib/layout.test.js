import { describe, it, expect } from 'vitest';
import { buildLayout } from './layout.js';

const items = [
  { id: 1, trimStart: 10, trimEnd: 0, file: {}, url: 'blob:a' },
  { id: 2, trimStart: 0, trimEnd: 5, file: {}, url: 'blob:b' },
];

describe('buildLayout', () => {
  it('builds the API layout from items and options', () => {
    const layout = buildLayout(items, {
      direction: 'vertical',
      spacing: 8,
      background: '#000000',
      format: 'png',
      quality: 90,
    });

    expect(layout).toEqual({
      direction: 'vertical',
      spacing: 8,
      background: '#000000',
      items: [
        { trimStart: 10, trimEnd: 0 },
        { trimStart: 0, trimEnd: 5 },
      ],
      output: { format: 'png' },
    });
  });

  it('includes quality only for jpeg', () => {
    const layout = buildLayout(items, {
      direction: 'horizontal',
      spacing: 0,
      background: '#ffffff',
      format: 'jpeg',
      quality: 85,
    });

    expect(layout.output).toEqual({ format: 'jpeg', quality: 85 });
  });

  it('coerces spacing to a clamped integer', () => {
    const opts = { direction: 'vertical', background: '#ffffff', format: 'png', quality: 90 };
    expect(buildLayout(items, { ...opts, spacing: 1.5 }).spacing).toBe(2);
    expect(buildLayout(items, { ...opts, spacing: NaN }).spacing).toBe(0);
    expect(buildLayout(items, { ...opts, spacing: 9999 }).spacing).toBe(500);
  });
});
