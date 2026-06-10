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
