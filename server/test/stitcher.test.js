import { describe, it, expect } from 'vitest';
import { stitch } from '../src/lib/stitcher.js';
import { solidImage, pixelAt } from './helpers.js';

describe('stitch — vertical core', () => {
  it('joins two images edge-to-edge, output width = max width', async () => {
    const red = await solidImage(100, 50, '#ff0000');
    const blue = await solidImage(100, 80, '#0000ff');

    const { data, width, height, format } = await stitch([red, blue], {
      direction: 'vertical',
    });

    expect(format).toBe('png');
    expect(width).toBe(100);
    expect(height).toBe(130);
    expect(await pixelAt(data, 50, 25)).toEqual([255, 0, 0]); // top half red
    expect(await pixelAt(data, 50, 100)).toEqual([0, 0, 255]); // bottom blue
  });

  it('centers narrower images over the background, never upscales', async () => {
    const wide = await solidImage(100, 40, '#ff0000');
    const narrow = await solidImage(60, 40, '#0000ff');

    const { data, width, height } = await stitch([wide, narrow], {
      direction: 'vertical',
      background: '#ffffff',
    });

    expect(width).toBe(100);
    expect(height).toBe(80);
    expect(await pixelAt(data, 10, 60)).toEqual([255, 255, 255]); // letterbox left
    expect(await pixelAt(data, 50, 60)).toEqual([0, 0, 255]); // centered narrow image
    expect(await pixelAt(data, 95, 60)).toEqual([255, 255, 255]); // letterbox right
  });
});
