import { describe, it, expect } from 'vitest';
import { stitch, MAX_DIMENSION } from '../src/lib/stitcher.js';
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

describe('stitch — trims, spacing, direction, formats', () => {
  it('applies trimStart/trimEnd before joining (vertical)', async () => {
    const red = await solidImage(100, 100, '#ff0000');
    const blue = await solidImage(100, 100, '#0000ff');

    const { data, height } = await stitch([red, blue], {
      direction: 'vertical',
      items: [
        { trimStart: 30, trimEnd: 20 }, // 100 -> 50
        { trimStart: 0, trimEnd: 60 }, // 100 -> 40
      ],
    });

    expect(height).toBe(90);
    expect(await pixelAt(data, 50, 49)).toEqual([255, 0, 0]);
    expect(await pixelAt(data, 50, 50)).toEqual([0, 0, 255]);
  });

  it('inserts spacing filled with the background color', async () => {
    const red = await solidImage(50, 40, '#ff0000');
    const blue = await solidImage(50, 40, '#0000ff');

    const { data, height } = await stitch([red, blue], {
      direction: 'vertical',
      spacing: 10,
      background: '#00ff00',
    });

    expect(height).toBe(90); // 40 + 10 + 40
    expect(await pixelAt(data, 25, 45)).toEqual([0, 255, 0]); // gap is green
  });

  it('stitches horizontally with height normalization and side trims', async () => {
    const red = await solidImage(80, 100, '#ff0000');
    const blue = await solidImage(80, 60, '#0000ff');

    const { data, width, height } = await stitch([red, blue], {
      direction: 'horizontal',
      background: '#ffffff',
      items: [
        { trimStart: 10, trimEnd: 10 }, // 80 -> 60 wide
        { trimStart: 0, trimEnd: 0 },
      ],
    });

    expect(width).toBe(140); // 60 + 80
    expect(height).toBe(100);
    expect(await pixelAt(data, 30, 50)).toEqual([255, 0, 0]);
    expect(await pixelAt(data, 100, 50)).toEqual([0, 0, 255]); // centered vertically
    expect(await pixelAt(data, 100, 5)).toEqual([255, 255, 255]); // letterbox above
  });

  it('encodes jpeg with the requested quality', async () => {
    const red = await solidImage(50, 50, '#ff0000');
    const blue = await solidImage(50, 50, '#0000ff');

    const { data, format } = await stitch([red, blue], {
      output: { format: 'jpeg', quality: 80 },
    });

    expect(format).toBe('jpeg');
    // JPEG magic bytes
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xd8);
  });
});

describe('stitch — errors', () => {
  it('rejects an undecodable buffer with INVALID_IMAGE and the index', async () => {
    const ok = await solidImage(50, 50, '#ff0000');
    const garbage = Buffer.from('not an image at all');

    await expect(stitch([ok, garbage], {})).rejects.toMatchObject({
      name: 'StitchError',
      code: 'INVALID_IMAGE',
      index: 1,
    });
  });

  it('rejects trims that consume the whole image with INVALID_TRIM', async () => {
    const a = await solidImage(50, 100, '#ff0000');
    const b = await solidImage(50, 100, '#0000ff');

    await expect(
      stitch([a, b], { items: [{ trimStart: 60, trimEnd: 40 }, { trimStart: 0, trimEnd: 0 }] })
    ).rejects.toMatchObject({ code: 'INVALID_TRIM', index: 0 });
  });

  it('rejects outputs exceeding MAX_DIMENSION with the computed size', async () => {
    const tall = await solidImage(10, 16000, '#ff0000');
    const buffers = [tall, tall, tall, tall, tall]; // 80,000 px > 65,000

    await expect(stitch(buffers, {})).rejects.toMatchObject({
      code: 'OUTPUT_TOO_LARGE',
      height: 80000,
    });
    expect(MAX_DIMENSION).toBe(65000);
  });

  it('rejects an empty input array', async () => {
    await expect(stitch([], {})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
