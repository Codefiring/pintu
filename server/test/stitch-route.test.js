import { describe, it, expect, afterEach } from 'vitest';
import FormData from 'form-data';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { solidImage } from './helpers.js';

function buildForm(buffers, layout) {
  const form = new FormData();
  buffers.forEach((buf, i) => {
    form.append('images', buf, { filename: `img${i}.png`, contentType: 'image/png' });
  });
  if (layout !== undefined) form.append('layout', JSON.stringify(layout));
  return form;
}

function post(app, form) {
  return app.inject({
    method: 'POST',
    url: '/api/stitch',
    payload: form,
    headers: form.getHeaders(),
  });
}

const baseLayout = {
  direction: 'vertical',
  spacing: 0,
  background: '#ffffff',
  items: [
    { trimStart: 0, trimEnd: 0 },
    { trimStart: 0, trimEnd: 0 },
  ],
  output: { format: 'png' },
};

describe('POST /api/stitch', () => {
  let app;
  afterEach(() => app?.close());

  it('stitches two pngs and returns the image as an attachment', async () => {
    app = buildApp();
    const a = await solidImage(100, 50, '#ff0000');
    const b = await solidImage(100, 70, '#0000ff');

    const res = await post(app, buildForm([a, b], baseLayout));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe('attachment; filename="pintu.png"');

    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(120);
  });

  it('returns jpeg when requested', async () => {
    app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(
      app,
      buildForm([a, b], { ...baseLayout, output: { format: 'jpeg', quality: 80 } })
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe('attachment; filename="pintu.jpg"');
  });
});

describe('POST /api/stitch — errors', () => {
  let app;
  afterEach(() => app?.close());

  it('400 when layout is missing', async () => {
    app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(app, buildForm([a, b], undefined));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_LAYOUT');
  });

  it('400 when layout has unknown fields or bad values', async () => {
    app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(app, buildForm([a, b], { ...baseLayout, direction: 'diagonal' }));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_LAYOUT');
  });

  it('400 when items length does not match file count', async () => {
    app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');
    const c = await solidImage(50, 50, '#00ff00');

    const res = await post(app, buildForm([a, b, c], baseLayout)); // 3 files, 2 items

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'ITEMS_MISMATCH', files: 3, items: 2 });
  });

  it('422 with the index when one file is not a valid image', async () => {
    app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const garbage = Buffer.from('definitely not a png');

    const res = await post(app, buildForm([a, garbage], baseLayout));

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'INVALID_IMAGE', index: 1 });
  });

  it('413 with computed size when the output would be too large', async () => {
    app = buildApp();
    const tall = await solidImage(10, 16000, '#ff0000');
    const layout = {
      ...baseLayout,
      items: Array.from({ length: 5 }, () => ({ trimStart: 0, trimEnd: 0 })),
    };

    const res = await post(app, buildForm([tall, tall, tall, tall, tall], layout));

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'OUTPUT_TOO_LARGE', height: 80000 });
  });
});
