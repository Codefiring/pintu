# Pintu (拼图) Long-Image Stitching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an anonymous one-shot web tool (Chinese UI) where users upload images, reorder/trim them client-side with a live preview, and the server stitches them into one long image with sharp and streams it back.

**Architecture:** Single repo, two packages. `frontend/` is a Vue 3 + Vite SPA that handles all arrangement against local thumbnails and uploads originals only on 生成. `server/` is Fastify + sharp with one stateless endpoint `POST /api/stitch`; `lib/stitcher.js` is a pure buffers-in/buffer-out module (the seam for future auto overlap-detection). One Docker container serves both API and built SPA.

**Tech Stack:** Node.js (ESM), Fastify 5, @fastify/multipart, @fastify/static, sharp, Ajv, Vue 3, Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-pintu-long-image-stitching-design.md`

---

## File Structure

```
pintu/
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── README.md
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── style.css
│       ├── App.vue                      # wires everything; owns options state
│       ├── lib/
│       │   ├── trim.js                  # clampTrim — pure, tested
│       │   └── layout.js                # buildLayout — pure, tested
│       ├── composables/
│       │   ├── useImages.js             # image list state: add/remove/move/trim
│       │   └── useStitchRequest.js      # XHR upload with progress, result blob
│       └── components/
│           ├── UploadZone.vue           # drop zone + file picker
│           ├── ImageList.vue            # drag-to-reorder list
│           ├── ImageCard.vue            # thumbnail + trim drag handles
│           ├── StitchPreview.vue        # pixel-faithful CSS-cropped preview
│           └── ExportPanel.vue          # options + 生成 button + errors
└── server/
    ├── package.json
    ├── src/
    │   ├── index.js                     # entrypoint: listen
    │   ├── app.js                       # buildApp factory (testable)
    │   ├── routes/stitch.js             # POST /api/stitch + Ajv validation
    │   └── lib/stitcher.js              # pure sharp pipeline
    └── test/
        ├── helpers.js                   # solidImage / pixelAt test utilities
        ├── stitcher.test.js
        ├── health.test.js
        └── stitch-route.test.js
```

Constants duplicated by design (no shared package for v1): max 30 files, 20 MB/file, 200 MB total, 65,000 px output cap. They appear in `server/src/routes/stitch.js`, `server/src/lib/stitcher.js`, and `frontend/src/composables/useImages.js`.

---

### Task 1: Repo hygiene + server scaffold with health check

**Files:**
- Create: `.gitignore`
- Create: `server/package.json`
- Create: `server/src/app.js`
- Create: `server/src/index.js`
- Test: `server/test/health.test.js`

- [ ] **Step 1: Create `.gitignore` at repo root**

```gitignore
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: Create `server/package.json`**

```json
{
  "name": "pintu-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run from `server/`:
```bash
npm install fastify @fastify/multipart @fastify/static sharp ajv
npm install -D vitest form-data
```
Expected: both commands exit 0; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 4: Write the failing health-check test**

Create `server/test/health.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run from `server/`: `npm test`
Expected: FAIL — `Cannot find module '../src/app.js'` (or similar).

- [ ] **Step 6: Create `server/src/app.js`**

```js
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

export const MAX_FILES = 30;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    requestTimeout: 60_000, // spec: stitch requests must finish within ~60 s
  });

  app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES,
      fields: 5,
      fieldSize: 64 * 1024,
    },
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
```

- [ ] **Step 7: Create `server/src/index.js`**

```js
import { buildApp } from './app.js';

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Run test to verify it passes**

Run from `server/`: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 9: Commit**

```bash
git add .gitignore server/
git commit -m "feat(server): scaffold Fastify app with health check"
```

---

### Task 2: Stitcher core — vertical stitch with width normalization

**Files:**
- Create: `server/test/helpers.js`
- Create: `server/src/lib/stitcher.js`
- Test: `server/test/stitcher.test.js`

- [ ] **Step 1: Create test helpers**

Create `server/test/helpers.js`:
```js
import sharp from 'sharp';

export function solidImage(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

export async function pixelAt(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return [data[idx], data[idx + 1], data[idx + 2]];
}
```

- [ ] **Step 2: Write failing tests for the basic vertical stitch**

Create `server/test/stitcher.test.js`:
```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run from `server/`: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/stitcher.js'`.

- [ ] **Step 4: Implement the stitcher core**

Create `server/src/lib/stitcher.js`:
```js
import sharp from 'sharp';

export const MAX_DIMENSION = 65000;

export class StitchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StitchError';
    this.code = code;
    Object.assign(this, details);
  }
}

const DEFAULT_OUTPUT = { format: 'png', quality: 90 };

export async function stitch(buffers, layout = {}) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new StitchError('INVALID_INPUT', 'at least one image is required');
  }

  const direction = layout.direction ?? 'vertical';
  const spacing = layout.spacing ?? 0;
  const background = layout.background ?? '#ffffff';
  const output = { ...DEFAULT_OUTPUT, ...layout.output };
  const items = layout.items ?? buffers.map(() => ({ trimStart: 0, trimEnd: 0 }));
  const vertical = direction === 'vertical';

  // Decode metadata and compute each image's extract region.
  const sources = [];
  for (let i = 0; i < buffers.length; i++) {
    let meta;
    try {
      meta = await sharp(buffers[i]).metadata();
    } catch {
      throw new StitchError('INVALID_IMAGE', `image ${i} could not be decoded`, { index: i });
    }
    const trimStart = items[i]?.trimStart ?? 0;
    const trimEnd = items[i]?.trimEnd ?? 0;
    const extent = vertical ? meta.height : meta.width;
    if (trimStart + trimEnd >= extent) {
      throw new StitchError('INVALID_TRIM', `image ${i} trimmed to nothing`, { index: i });
    }
    const region = vertical
      ? { left: 0, top: trimStart, width: meta.width, height: meta.height - trimStart - trimEnd }
      : { left: trimStart, top: 0, width: meta.width - trimStart - trimEnd, height: meta.height };
    sources.push({ buffer: buffers[i], region });
  }

  // Canvas size: cross-axis = max, main-axis = sum + spacing gaps.
  let width, height;
  if (vertical) {
    width = Math.max(...sources.map((s) => s.region.width));
    height =
      sources.reduce((sum, s) => sum + s.region.height, 0) + spacing * (sources.length - 1);
  } else {
    height = Math.max(...sources.map((s) => s.region.height));
    width =
      sources.reduce((sum, s) => sum + s.region.width, 0) + spacing * (sources.length - 1);
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new StitchError(
      'OUTPUT_TOO_LARGE',
      `output ${width}x${height} exceeds ${MAX_DIMENSION}px`,
      { width, height }
    );
  }

  // Place each trimmed image, centered on the cross axis.
  let offset = 0;
  const composites = [];
  for (const s of sources) {
    const input = await sharp(s.buffer).extract(s.region).toBuffer();
    composites.push(
      vertical
        ? { input, top: offset, left: Math.round((width - s.region.width) / 2) }
        : { input, top: Math.round((height - s.region.height) / 2), left: offset }
    );
    offset += (vertical ? s.region.height : s.region.width) + spacing;
  }

  let pipeline = sharp({ create: { width, height, channels: 3, background } }).composite(
    composites
  );
  pipeline =
    output.format === 'jpeg' ? pipeline.jpeg({ quality: output.quality }) : pipeline.png();

  const data = await pipeline.toBuffer();
  return { data, width, height, format: output.format };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `server/`: `npm test`
Expected: PASS — 3 tests passed (1 health + 2 stitcher).

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): stitcher core — vertical stitch with centering"
```

---

### Task 3: Stitcher — trims, spacing, background, horizontal, jpeg

**Files:**
- Modify: `server/test/stitcher.test.js` (append tests; implementation from Task 2 already supports these — these tests pin the behavior)

- [ ] **Step 1: Append the tests**

Append to `server/test/stitcher.test.js`:
```js
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run from `server/`: `npm test`
Expected: PASS — 7 tests. (If any fail, the Task 2 implementation has a bug — fix `stitcher.js`, not the tests.)

- [ ] **Step 3: Commit**

```bash
git add server/test/stitcher.test.js
git commit -m "test(server): pin trim, spacing, horizontal, and jpeg behavior"
```

---

### Task 4: Stitcher — error cases

**Files:**
- Modify: `server/test/stitcher.test.js` (append)
- Modify: `server/src/lib/stitcher.js` (only if a test exposes a gap)

- [ ] **Step 1: Append failing/pinning error tests**

Append to `server/test/stitcher.test.js`:
```js
import { MAX_DIMENSION } from '../src/lib/stitcher.js';

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
```

- [ ] **Step 2: Run tests**

Run from `server/`: `npm test`
Expected: PASS — 11 tests. The Task 2 implementation already throws these; if anything fails, fix `stitcher.js`.

- [ ] **Step 3: Commit**

```bash
git add server/
git commit -m "test(server): stitcher error cases"
```

---

### Task 5: `POST /api/stitch` route — happy path

**Files:**
- Create: `server/src/routes/stitch.js`
- Modify: `server/src/app.js`
- Test: `server/test/stitch-route.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `server/test/stitch-route.test.js`:
```js
import { describe, it, expect } from 'vitest';
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
  it('stitches two pngs and returns the image as an attachment', async () => {
    const app = buildApp();
    const a = await solidImage(100, 50, '#ff0000');
    const b = await solidImage(100, 70, '#0000ff');

    const res = await post(app, buildForm([a, b], baseLayout));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toContain('pintu.png');

    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(120);
  });

  it('returns jpeg when requested', async () => {
    const app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(
      app,
      buildForm([a, b], { ...baseLayout, output: { format: 'jpeg', quality: 80 } })
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toContain('pintu.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `server/`: `npm test`
Expected: FAIL — 404 responses (route not registered yet).

- [ ] **Step 3: Implement the route**

Create `server/src/routes/stitch.js`:
```js
import Ajv from 'ajv';
import { stitch, StitchError } from '../lib/stitcher.js';

const MAX_FILES = 30;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;

const layoutSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['direction', 'items', 'output'],
  properties: {
    direction: { enum: ['vertical', 'horizontal'] },
    spacing: { type: 'integer', minimum: 0, maximum: 500, default: 0 },
    background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#ffffff' },
    items: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_FILES,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trimStart: { type: 'integer', minimum: 0, default: 0 },
          trimEnd: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['format'],
      properties: {
        format: { enum: ['png', 'jpeg'] },
        quality: { type: 'integer', minimum: 1, maximum: 100, default: 90 },
      },
    },
  },
};

const ajv = new Ajv({ useDefaults: true });
const validateLayout = ajv.compile(layoutSchema);

export default async function stitchRoutes(app) {
  app.post('/api/stitch', async (req, reply) => {
    const buffers = [];
    let layout = null;
    let total = 0;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        total += buf.length;
        if (total > MAX_TOTAL_SIZE) {
          return reply.code(413).send({ error: 'TOTAL_TOO_LARGE' });
        }
        buffers.push(buf);
      } else if (part.fieldname === 'layout') {
        try {
          layout = JSON.parse(part.value);
        } catch {
          return reply.code(400).send({ error: 'INVALID_LAYOUT_JSON' });
        }
      }
    }

    if (!layout || !validateLayout(layout)) {
      return reply
        .code(400)
        .send({ error: 'INVALID_LAYOUT', details: validateLayout.errors ?? 'missing layout' });
    }
    if (layout.items.length !== buffers.length) {
      return reply
        .code(400)
        .send({ error: 'ITEMS_MISMATCH', files: buffers.length, items: layout.items.length });
    }

    try {
      const { data, format } = await stitch(buffers, layout);
      const isJpeg = format === 'jpeg';
      return reply
        .type(isJpeg ? 'image/jpeg' : 'image/png')
        .header('Content-Disposition', `attachment; filename="pintu.${isJpeg ? 'jpg' : 'png'}"`)
        .send(data);
    } catch (err) {
      if (err instanceof StitchError) {
        if (err.code === 'OUTPUT_TOO_LARGE') {
          return reply.code(413).send({ error: err.code, width: err.width, height: err.height });
        }
        return reply.code(422).send({ error: err.code, index: err.index });
      }
      req.log.error(err);
      return reply.code(500).send({ error: 'STITCH_FAILED' });
    }
  });
}
```

- [ ] **Step 4: Register the route in `server/src/app.js`**

Add the import at the top:
```js
import stitchRoutes from './routes/stitch.js';
```
Add inside `buildApp`, after the multipart registration:
```js
  app.register(stitchRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `server/`: `npm test`
Expected: PASS — 13 tests.

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): POST /api/stitch with layout validation"
```

---

### Task 6: Route error handling tests

**Files:**
- Modify: `server/test/stitch-route.test.js` (append; route code from Task 5 already handles these)

- [ ] **Step 1: Append the error tests**

Append to `server/test/stitch-route.test.js`:
```js
describe('POST /api/stitch — errors', () => {
  it('400 when layout is missing', async () => {
    const app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(app, buildForm([a, b], undefined));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_LAYOUT');
  });

  it('400 when layout has unknown fields or bad values', async () => {
    const app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');

    const res = await post(app, buildForm([a, b], { ...baseLayout, direction: 'diagonal' }));

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_LAYOUT');
  });

  it('400 when items length does not match file count', async () => {
    const app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const b = await solidImage(50, 50, '#0000ff');
    const c = await solidImage(50, 50, '#00ff00');

    const res = await post(app, buildForm([a, b, c], baseLayout)); // 3 files, 2 items

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'ITEMS_MISMATCH', files: 3, items: 2 });
  });

  it('422 with the index when one file is not a valid image', async () => {
    const app = buildApp();
    const a = await solidImage(50, 50, '#ff0000');
    const garbage = Buffer.from('definitely not a png');

    const res = await post(app, buildForm([a, garbage], baseLayout));

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'INVALID_IMAGE', index: 1 });
  });

  it('413 with computed size when the output would be too large', async () => {
    const app = buildApp();
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
```

- [ ] **Step 2: Run tests**

Run from `server/`: `npm test`
Expected: PASS — 18 tests. If any fail, fix `routes/stitch.js` (not the tests).

- [ ] **Step 3: Commit**

```bash
git add server/test/stitch-route.test.js
git commit -m "test(server): stitch route error handling"
```

---

### Task 7: Serve the frontend build as static files

**Files:**
- Modify: `server/src/app.js`

- [ ] **Step 1: Register @fastify/static guarded by existence**

In `server/src/app.js`, add imports at the top:
```js
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```
Add inside `buildApp`, after the routes registration:
```js
  const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  if (existsSync(distDir)) {
    app.register(fastifyStatic, { root: distDir });
  }
```
The existence guard keeps tests and API-only dev runs working before the frontend is ever built. The path `server/src/../../frontend/dist` resolves to `frontend/dist` both in the repo and in the Docker image layout (Task 14).

- [ ] **Step 2: Run tests to verify nothing broke**

Run from `server/`: `npm test`
Expected: PASS — 18 tests.

- [ ] **Step 3: Commit**

```bash
git add server/src/app.js
git commit -m "feat(server): serve built frontend statics when present"
```

---

### Task 8: Frontend scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.js`
- Create: `frontend/src/style.css`
- Create: `frontend/src/App.vue` (placeholder; replaced in Task 13)

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "pintu-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run from `frontend/`:
```bash
npm install vue
npm install -D vite @vitejs/plugin-vue vitest
```
Expected: exit 0.

- [ ] **Step 3: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>拼图 — 长图拼接</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/main.js`**

```js
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
```

- [ ] **Step 6: Create placeholder `frontend/src/App.vue`**

```vue
<template>
  <h1>拼图</h1>
</template>
```

- [ ] **Step 7: Create `frontend/src/style.css`**

```css
:root {
  --accent: #3b6ef6;
  --border: #e2e2e6;
  --bg: #f6f7f9;
  --danger: #d4380d;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg);
  color: #222;
}

button {
  font: inherit;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

- [ ] **Step 8: Verify dev server boots**

Run from `frontend/`: `npm run build`
Expected: exit 0, `frontend/dist/` created with `index.html`.

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vue 3 + Vite app"
```

---

### Task 9: Pure logic — `clampTrim` and `buildLayout` (TDD)

**Files:**
- Create: `frontend/src/lib/trim.js`
- Create: `frontend/src/lib/layout.js`
- Test: `frontend/src/lib/trim.test.js`
- Test: `frontend/src/lib/layout.test.js`

- [ ] **Step 1: Write failing tests for `clampTrim`**

Create `frontend/src/lib/trim.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure**

Run from `frontend/`: `npm test`
Expected: FAIL — `Cannot find module './trim.js'`.

- [ ] **Step 3: Implement `frontend/src/lib/trim.js`**

```js
const MIN_REMAINING = 1;

export function clampTrim(extent, trimStart, trimEnd) {
  const s = Math.max(0, Math.round(trimStart));
  const e = Math.max(0, Math.round(trimEnd));
  const cappedStart = Math.min(s, extent - MIN_REMAINING);
  const cappedEnd = Math.min(e, extent - MIN_REMAINING - cappedStart);
  return { trimStart: cappedStart, trimEnd: cappedEnd };
}
```

- [ ] **Step 4: Run to verify pass**

Run from `frontend/`: `npm test`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write failing tests for `buildLayout`**

Create `frontend/src/lib/layout.test.js`:
```js
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
});
```

- [ ] **Step 6: Run to verify failure**

Run from `frontend/`: `npm test`
Expected: FAIL — `Cannot find module './layout.js'`.

- [ ] **Step 7: Implement `frontend/src/lib/layout.js`**

```js
export function buildLayout(items, options) {
  return {
    direction: options.direction,
    spacing: options.spacing,
    background: options.background,
    items: items.map((it) => ({ trimStart: it.trimStart, trimEnd: it.trimEnd })),
    output:
      options.format === 'jpeg'
        ? { format: 'jpeg', quality: options.quality }
        : { format: 'png' },
  };
}
```

- [ ] **Step 8: Run to verify pass**

Run from `frontend/`: `npm test`
Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat(frontend): clampTrim and buildLayout pure logic"
```

---

### Task 10: `useImages` composable (TDD)

**Files:**
- Create: `frontend/src/composables/useImages.js`
- Test: `frontend/src/composables/useImages.test.js`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/composables/useImages.test.js`:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useImages } from './useImages.js';

const fakeLoader = vi.fn(async () => ({ url: 'blob:fake', width: 100, height: 200 }));

function fakeFile(name, type = 'image/png', size = 1000) {
  return { name, type, size };
}

beforeEach(() => {
  globalThis.URL.revokeObjectURL = vi.fn();
  fakeLoader.mockClear();
});

describe('useImages', () => {
  it('adds image files with dimensions and zero trims', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const rejected = await addFiles([fakeFile('a.png'), fakeFile('b.png')]);

    expect(rejected).toEqual([]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ width: 100, height: 200, trimStart: 0, trimEnd: 0 });
    expect(items[0].id).not.toBe(items[1].id);
  });

  it('rejects non-images and oversize files with reasons', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const rejected = await addFiles([
      fakeFile('doc.pdf', 'application/pdf'),
      fakeFile('huge.png', 'image/png', 21 * 1024 * 1024),
      fakeFile('ok.png'),
    ]);

    expect(items).toHaveLength(1);
    expect(rejected).toEqual([
      { name: 'doc.pdf', reason: 'not_image' },
      { name: 'huge.png', reason: 'too_large' },
    ]);
  });

  it('rejects files beyond the 30-image cap', async () => {
    const { items, addFiles } = useImages(fakeLoader);
    const files = Array.from({ length: 31 }, (_, i) => fakeFile(`f${i}.png`));
    const rejected = await addFiles(files);

    expect(items).toHaveLength(30);
    expect(rejected).toEqual([{ name: 'f30.png', reason: 'too_many' }]);
  });

  it('moves an item to a new position', async () => {
    const { items, addFiles, move } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png'), fakeFile('b.png'), fakeFile('c.png')]);
    const [a, b, c] = items.map((it) => it.id);

    move(0, 2);

    expect(items.map((it) => it.id)).toEqual([b, c, a]);
  });

  it('removes an item and revokes its object URL', async () => {
    const { items, addFiles, remove } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png'), fakeFile('b.png')]);

    remove(items[0].id);

    expect(items).toHaveLength(1);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('clamps trims against the direction extent', async () => {
    const { items, addFiles, setTrim } = useImages(fakeLoader);
    await addFiles([fakeFile('a.png')]); // 100w x 200h

    setTrim(items[0].id, 'vertical', { trimStart: 150, trimEnd: 100 });
    expect(items[0]).toMatchObject({ trimStart: 150, trimEnd: 49 }); // 200px extent

    setTrim(items[0].id, 'horizontal', { trimStart: 90, trimEnd: 50 });
    expect(items[0]).toMatchObject({ trimStart: 90, trimEnd: 9 }); // 100px extent
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run from `frontend/`: `npm test`
Expected: FAIL — `Cannot find module './useImages.js'`.

- [ ] **Step 3: Implement `frontend/src/composables/useImages.js`**

```js
import { reactive } from 'vue';
import { clampTrim } from '../lib/trim.js';

export const MAX_FILES = 30;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

let nextId = 1;

export function loadDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

export function useImages(dimensionLoader = loadDimensions) {
  const items = reactive([]);

  async function addFiles(files) {
    const rejected = [];
    for (const file of files) {
      if (items.length >= MAX_FILES) {
        rejected.push({ name: file.name, reason: 'too_many' });
        continue;
      }
      if (!file.type?.startsWith('image/')) {
        rejected.push({ name: file.name, reason: 'not_image' });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push({ name: file.name, reason: 'too_large' });
        continue;
      }
      try {
        const { url, width, height } = await dimensionLoader(file);
        items.push({ id: nextId++, file, url, width, height, trimStart: 0, trimEnd: 0 });
      } catch {
        rejected.push({ name: file.name, reason: 'not_image' });
      }
    }
    return rejected;
  }

  function remove(id) {
    const i = items.findIndex((it) => it.id === id);
    if (i === -1) return;
    URL.revokeObjectURL(items[i].url);
    items.splice(i, 1);
  }

  function move(from, to) {
    if (from === to) return;
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
  }

  function setTrim(id, direction, patch) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const extent = direction === 'vertical' ? it.height : it.width;
    Object.assign(
      it,
      clampTrim(extent, patch.trimStart ?? it.trimStart, patch.trimEnd ?? it.trimEnd)
    );
  }

  return { items, addFiles, remove, move, setTrim };
}
```

- [ ] **Step 4: Run to verify pass**

Run from `frontend/`: `npm test`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/
git commit -m "feat(frontend): useImages composable with limits and trim clamping"
```

---

### Task 11: `useStitchRequest` composable

**Files:**
- Create: `frontend/src/composables/useStitchRequest.js`

No automated test — this is a thin XHR wrapper; the JSON it sends is covered by the `buildLayout` tests and the server contract by route tests. Verified end-to-end in Task 15.

- [ ] **Step 1: Implement `frontend/src/composables/useStitchRequest.js`**

```js
import { ref } from 'vue';
import { buildLayout } from '../lib/layout.js';

function messageFor(status, bodyText) {
  let body = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    // non-JSON error body; fall through to generic messages
  }
  if (status === 413 && body.error === 'OUTPUT_TOO_LARGE') {
    return `生成的图片过大（${body.width}×${body.height} 像素），请减少图片数量或改用 JPG`;
  }
  if (status === 413) return '上传内容过大，请减少图片数量或压缩图片';
  if (status === 422) return `第 ${Number(body.index ?? 0) + 1} 张图片无法处理，请移除后重试`;
  if (status === 400) return '请求参数有误，请刷新页面后重试';
  return '生成失败，请重试';
}

export function useStitchRequest() {
  const busy = ref(false);
  const progress = ref(0);
  const error = ref('');
  const resultUrl = ref('');
  const resultFormat = ref('png');

  function stitch(items, options) {
    busy.value = true;
    progress.value = 0;
    error.value = '';
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value);
      resultUrl.value = '';
    }

    const form = new FormData();
    for (const it of items) form.append('images', it.file, it.file.name);
    form.append('layout', JSON.stringify(buildLayout(items, options)));

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/stitch');
      xhr.responseType = 'blob';
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100);
      };
      xhr.onload = async () => {
        busy.value = false;
        if (xhr.status === 200) {
          resultUrl.value = URL.createObjectURL(xhr.response);
          resultFormat.value = options.format;
          resolve(true);
        } else {
          error.value = messageFor(xhr.status, await xhr.response.text());
          resolve(false);
        }
      };
      xhr.onerror = () => {
        busy.value = false;
        error.value = '网络错误，请检查连接后重试';
        resolve(false);
      };
      xhr.send(form);
    });
  }

  return { busy, progress, error, resultUrl, resultFormat, stitch };
}
```

- [ ] **Step 2: Run existing tests (regression only)**

Run from `frontend/`: `npm test`
Expected: PASS — 12 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/composables/useStitchRequest.js
git commit -m "feat(frontend): stitch request composable with upload progress"
```

---

### Task 12: Components — UploadZone, ImageCard, ImageList

**Files:**
- Create: `frontend/src/components/UploadZone.vue`
- Create: `frontend/src/components/ImageCard.vue`
- Create: `frontend/src/components/ImageList.vue`

These are interaction-heavy components; per the spec, drag behavior is verified manually (Task 15). The logic they delegate to (`clampTrim` via `setTrim`) is already tested.

- [ ] **Step 1: Create `frontend/src/components/UploadZone.vue`**

```vue
<script setup>
import { ref } from 'vue';

const emit = defineEmits(['files']);
const dragging = ref(false);
const inputEl = ref(null);

function onDrop(e) {
  dragging.value = false;
  emit('files', [...e.dataTransfer.files]);
}

function onPick(e) {
  emit('files', [...e.target.files]);
  e.target.value = '';
}
</script>

<template>
  <div
    class="upload-zone"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
    @click="inputEl.click()"
  >
    <p class="main">点击或拖拽图片到此处</p>
    <p class="hint">最多 30 张，单张不超过 20MB</p>
    <input ref="inputEl" type="file" accept="image/*" multiple hidden @change="onPick" />
  </div>
</template>

<style scoped>
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  background: #fff;
  cursor: pointer;
}
.upload-zone.dragging {
  border-color: var(--accent);
  background: #eef3ff;
}
.main { margin: 0; font-size: 16px; }
.hint { margin: 8px 0 0; color: #888; font-size: 13px; }
</style>
```

- [ ] **Step 2: Create `frontend/src/components/ImageCard.vue`**

Trim handles: shaded overlays show the trimmed regions; dragging a handle converts pointer movement from displayed px to natural px and emits a `trim` patch (clamping happens in `useImages.setTrim`). `@dragstart.prevent.stop` plus `e.preventDefault()` on pointerdown stop the handles from triggering the parent's HTML5 reorder drag.

```vue
<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  item: { type: Object, required: true },
  direction: { type: String, default: 'vertical' },
});
const emit = defineEmits(['trim', 'remove']);

const thumbEl = ref(null);
const vertical = computed(() => props.direction === 'vertical');
const extent = computed(() => (vertical.value ? props.item.height : props.item.width));

function naturalPerDisplayedPx() {
  const el = thumbEl.value;
  const displayed = vertical.value ? el.clientHeight : el.clientWidth;
  return extent.value / displayed;
}

function startDrag(edge, e) {
  e.preventDefault();
  e.stopPropagation();
  const startPos = vertical.value ? e.clientY : e.clientX;
  const startTrim = props.item[edge];
  const k = naturalPerDisplayedPx();
  const onMove = (ev) => {
    const pos = vertical.value ? ev.clientY : ev.clientX;
    const delta = (pos - startPos) * (edge === 'trimStart' ? 1 : -1);
    emit('trim', props.item.id, { [edge]: startTrim + Math.round(delta * k) });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

const startPct = computed(() => `${(props.item.trimStart / extent.value) * 100}%`);
const endPct = computed(() => `${(props.item.trimEnd / extent.value) * 100}%`);

const shadeStartStyle = computed(() =>
  vertical.value
    ? { top: 0, left: 0, right: 0, height: startPct.value }
    : { top: 0, bottom: 0, left: 0, width: startPct.value }
);
const shadeEndStyle = computed(() =>
  vertical.value
    ? { bottom: 0, left: 0, right: 0, height: endPct.value }
    : { top: 0, bottom: 0, right: 0, width: endPct.value }
);
const handleStartStyle = computed(() =>
  vertical.value ? { top: startPct.value, left: 0, right: 0 } : { left: startPct.value, top: 0, bottom: 0 }
);
const handleEndStyle = computed(() =>
  vertical.value ? { bottom: endPct.value, left: 0, right: 0 } : { right: endPct.value, top: 0, bottom: 0 }
);
</script>

<template>
  <div class="image-card">
    <div ref="thumbEl" class="thumb">
      <img :src="item.url" :alt="item.file.name" draggable="false" />
      <div class="shade" :style="shadeStartStyle"></div>
      <div class="shade" :style="shadeEndStyle"></div>
      <div
        class="handle"
        :class="vertical ? 'v' : 'h'"
        :style="handleStartStyle"
        @pointerdown="startDrag('trimStart', $event)"
        @dragstart.prevent.stop
      ></div>
      <div
        class="handle"
        :class="vertical ? 'v' : 'h'"
        :style="handleEndStyle"
        @pointerdown="startDrag('trimEnd', $event)"
        @dragstart.prevent.stop
      ></div>
    </div>
    <div class="meta">
      <span class="name" :title="item.file.name">{{ item.file.name }}</span>
      <button class="remove" title="移除" @click="emit('remove', item.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.image-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.thumb {
  position: relative;
  line-height: 0;
}
.thumb img {
  width: 100%;
  display: block;
}
.shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.handle {
  position: absolute;
  background: var(--accent);
  opacity: 0.85;
  touch-action: none;
}
.handle.v { height: 8px; cursor: ns-resize; }
.handle.h { width: 8px; cursor: ew-resize; }
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  border: none;
  background: none;
  color: var(--danger);
  font-size: 14px;
  padding: 0 4px;
}
</style>
```

- [ ] **Step 3: Create `frontend/src/components/ImageList.vue`**

```vue
<script setup>
import { ref } from 'vue';
import ImageCard from './ImageCard.vue';

defineProps({
  items: { type: Array, required: true },
  direction: { type: String, default: 'vertical' },
});
const emit = defineEmits(['trim', 'remove', 'move']);

const dragFrom = ref(null);

function onDragStart(i) {
  dragFrom.value = i;
}
function onDrop(i) {
  if (dragFrom.value !== null && dragFrom.value !== i) emit('move', dragFrom.value, i);
  dragFrom.value = null;
}
</script>

<template>
  <div class="image-list">
    <div
      v-for="(item, i) in items"
      :key="item.id"
      class="slot"
      draggable="true"
      @dragstart="onDragStart(i)"
      @dragover.prevent
      @drop.prevent="onDrop(i)"
    >
      <span class="order">{{ i + 1 }}</span>
      <ImageCard
        :item="item"
        :direction="direction"
        @trim="(id, patch) => emit('trim', id, patch)"
        @remove="(id) => emit('remove', id)"
      />
    </div>
  </div>
</template>

<style scoped>
.image-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.slot {
  position: relative;
  cursor: grab;
}
.order {
  position: absolute;
  top: -8px;
  left: -8px;
  z-index: 1;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
```

- [ ] **Step 4: Run tests (regression) and build**

Run from `frontend/`: `npm test && npm run build`
Expected: tests PASS, build exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): upload zone, image card with trim handles, reorderable list"
```

---

### Task 13: StitchPreview, ExportPanel, and App wiring

**Files:**
- Create: `frontend/src/components/StitchPreview.vue`
- Create: `frontend/src/components/ExportPanel.vue`
- Modify: `frontend/src/App.vue` (replace placeholder)
- Modify: `frontend/src/style.css` (append layout styles)

- [ ] **Step 1: Create `frontend/src/components/StitchPreview.vue`**

Pixel-faithful preview: pieces are CSS-cropped `<img>`s scaled by a single factor `k` (preview cross-axis ÷ widest image), so proportions, trims, spacing, and centering match the server output exactly.

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  direction: { type: String, default: 'vertical' },
  spacing: { type: Number, default: 0 },
  background: { type: String, default: '#ffffff' },
});

const PREVIEW_EXTENT = 320; // displayed px across the stitch axis

const vertical = computed(() => props.direction === 'vertical');
const crossMax = computed(() =>
  Math.max(...props.items.map((it) => (vertical.value ? it.width : it.height)), 1)
);
const k = computed(() => PREVIEW_EXTENT / crossMax.value);

function pieceStyle(it) {
  const main = (vertical.value ? it.height : it.width) - it.trimStart - it.trimEnd;
  return vertical.value
    ? { width: `${it.width * k.value}px`, height: `${main * k.value}px` }
    : { width: `${main * k.value}px`, height: `${it.height * k.value}px` };
}

function imgStyle(it) {
  return vertical.value
    ? { width: `${it.width * k.value}px`, marginTop: `${-it.trimStart * k.value}px` }
    : { height: `${it.height * k.value}px`, marginLeft: `${-it.trimStart * k.value}px` };
}

const containerStyle = computed(() => ({
  background: props.background,
  gap: `${props.spacing * k.value}px`,
  flexDirection: vertical.value ? 'column' : 'row',
}));
</script>

<template>
  <div v-if="items.length" class="stitch-preview" :style="containerStyle">
    <div v-for="it in items" :key="it.id" class="piece" :style="pieceStyle(it)">
      <img :src="it.url" :style="imgStyle(it)" draggable="false" />
    </div>
  </div>
</template>

<style scoped>
.stitch-preview {
  display: flex;
  align-items: center;
  width: fit-content;
  border: 1px solid var(--border);
}
.piece {
  overflow: hidden;
  flex: none;
}
.piece img {
  display: block;
}
</style>
```

- [ ] **Step 2: Create `frontend/src/components/ExportPanel.vue`**

```vue
<script setup>
defineProps({
  options: { type: Object, required: true }, // reactive; panel mutates its fields
  canStitch: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  error: { type: String, default: '' },
});
const emit = defineEmits(['stitch']);
</script>

<template>
  <div class="export-panel">
    <label>
      拼接方向
      <select v-model="options.direction">
        <option value="vertical">纵向</option>
        <option value="horizontal">横向</option>
      </select>
    </label>
    <label>
      间距 (px)
      <input type="number" min="0" max="500" v-model.number="options.spacing" />
    </label>
    <label>
      背景颜色
      <input type="color" v-model="options.background" />
    </label>
    <label>
      输出格式
      <select v-model="options.format">
        <option value="png">PNG</option>
        <option value="jpeg">JPG</option>
      </select>
    </label>
    <label v-if="options.format === 'jpeg'">
      质量 {{ options.quality }}
      <input type="range" min="1" max="100" v-model.number="options.quality" />
    </label>
    <button class="go" :disabled="!canStitch || busy" @click="emit('stitch')">
      {{ busy ? `上传中 ${progress}%` : '生成长图' }}
    </button>
    <p v-if="!canStitch" class="hint">请至少添加 2 张图片</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.export-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.go {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px;
  font-size: 15px;
}
.hint { margin: 0; color: #888; font-size: 12px; }
.error { margin: 0; color: var(--danger); font-size: 13px; }
</style>
```

- [ ] **Step 3: Replace `frontend/src/App.vue`**

Note the direction watcher: trims are stored relative to the stitch direction, so switching direction resets all trims to zero (predictable, avoids nonsense crops).

```vue
<script setup>
import { reactive, computed, ref, watch } from 'vue';
import UploadZone from './components/UploadZone.vue';
import ImageList from './components/ImageList.vue';
import StitchPreview from './components/StitchPreview.vue';
import ExportPanel from './components/ExportPanel.vue';
import { useImages } from './composables/useImages.js';
import { useStitchRequest } from './composables/useStitchRequest.js';

const { items, addFiles, remove, move, setTrim } = useImages();
const { busy, progress, error, resultUrl, resultFormat, stitch } = useStitchRequest();

const options = reactive({
  direction: 'vertical',
  spacing: 0,
  background: '#ffffff',
  format: 'png',
  quality: 90,
});

watch(
  () => options.direction,
  () => {
    for (const it of items) {
      it.trimStart = 0;
      it.trimEnd = 0;
    }
  }
);

const toast = ref('');
const REASONS = {
  too_many: '超过 30 张上限',
  not_image: '不是有效图片',
  too_large: '文件过大，单张最大 20MB',
};

async function onFiles(files) {
  const rejected = await addFiles(files);
  if (rejected.length) {
    toast.value = rejected.map((r) => `${r.name}：${REASONS[r.reason]}`).join('；');
    setTimeout(() => (toast.value = ''), 5000);
  }
}

const canStitch = computed(() => items.length >= 2);
const downloadName = computed(() => `pintu.${resultFormat.value === 'jpeg' ? 'jpg' : 'png'}`);

function onTrim(id, patch) {
  setTrim(id, options.direction, patch);
}
</script>

<template>
  <header class="topbar">
    <h1>拼图 · 长图拼接</h1>
  </header>

  <main class="layout">
    <section class="work">
      <UploadZone @files="onFiles" />
      <p v-if="toast" class="toast">{{ toast }}</p>
      <ImageList
        :items="items"
        :direction="options.direction"
        @trim="onTrim"
        @remove="remove"
        @move="move"
      />
    </section>

    <aside class="side">
      <ExportPanel
        :options="options"
        :can-stitch="canStitch"
        :busy="busy"
        :progress="progress"
        :error="error"
        @stitch="stitch(items, options)"
      />
      <div v-if="resultUrl" class="result">
        <a class="download" :href="resultUrl" :download="downloadName">下载长图</a>
        <img :src="resultUrl" alt="拼接结果" />
      </div>
      <h2 v-if="items.length">预览</h2>
      <StitchPreview
        :items="items"
        :direction="options.direction"
        :spacing="options.spacing"
        :background="options.background"
      />
    </aside>
  </main>
</template>
```

- [ ] **Step 4: Append layout styles to `frontend/src/style.css`**

```css
.topbar {
  background: #fff;
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
}
.topbar h1 {
  margin: 0;
  font-size: 18px;
}

.layout {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  padding: 20px 24px;
  align-items: start;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.work {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toast {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff1f0;
  color: var(--danger);
  font-size: 13px;
}

.result {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.result img {
  max-width: 100%;
  display: block;
  margin-top: 8px;
}
.download {
  display: inline-block;
  background: #18a058;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  padding: 8px 16px;
}
```

- [ ] **Step 5: Run tests and build**

Run from `frontend/`: `npm test && npm run build`
Expected: tests PASS, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): preview, export panel, and app wiring"
```

---

### Task 14: Dockerfile, compose, README

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
# ---- frontend build ----
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- server runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
# app.js resolves ../../frontend/dist relative to server/src
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  pintu:
    build: .
    ports:
      - "3000:3000"
    restart: unless-stopped
```

- [ ] **Step 3: Create `README.md`**

```markdown
# 拼图 (Pintu) — 长图拼接

匿名、一次性的在线长图拼接工具：上传图片 → 排序/裁边 → 生成长图下载。
图片仅在生成请求期间经过服务器，处理完立即丢弃，不做任何存储。

## 开发

```bash
# 终端 1 — 后端 (http://localhost:3000)
cd server && npm install && npm run dev

# 终端 2 — 前端 (http://localhost:5173，/api 代理到 3000)
cd frontend && npm install && npm run dev
```

## 测试

```bash
cd server && npm test
cd frontend && npm test
```

## 部署 (VPS)

```bash
docker compose up -d --build
```

服务监听 3000 端口，由宿主机的 nginx/caddy 反代。
注意：反向代理需放行较大的请求体（图片总量上限 200MB），例如 nginx 设置
`client_max_body_size 200m;` 和 `proxy_read_timeout 60s;`。

## 限制

- 单次最多 30 张图片，单张 ≤ 20MB，总量 ≤ 200MB
- 输出图片单边 ≤ 65000 像素

## 设计文档

- 设计规格：`docs/superpowers/specs/2026-06-10-pintu-long-image-stitching-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-10-pintu-long-image-stitching.md`
```

- [ ] **Step 4: Build the image to verify**

Run from repo root: `docker build -t pintu .`
Expected: build succeeds. (If Docker is unavailable in the environment, note it and rely on Task 15's non-Docker smoke test.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml README.md
git commit -m "feat: dockerize and document"
```

---

### Task 15: End-to-end smoke test (manual verification)

**Files:** none (verification only)

- [ ] **Step 1: Build frontend and start the server**

```bash
cd frontend && npm run build && cd ../server && npm start &
sleep 2
curl -s http://localhost:3000/api/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 2: Verify the SPA is served**

```bash
curl -s http://localhost:3000/ | head -3
```
Expected: HTML containing `拼图`.

- [ ] **Step 3: Stitch two generated images via curl**

```bash
cd server
node -e "import('sharp').then(async ({ default: sharp }) => {
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ff0000' } }).png().toFile('/tmp/a.png');
  await sharp({ create: { width: 300, height: 150, channels: 3, background: '#0000ff' } }).png().toFile('/tmp/b.png');
})"
curl -s -o /tmp/out.png \
  -F 'images=@/tmp/a.png' -F 'images=@/tmp/b.png' \
  -F 'layout={"direction":"vertical","spacing":10,"background":"#00ff00","items":[{"trimStart":0,"trimEnd":0},{"trimStart":0,"trimEnd":0}],"output":{"format":"png"}}' \
  http://localhost:3000/api/stitch
node -e "import('sharp').then(async ({ default: sharp }) => {
  const m = await sharp('/tmp/out.png').metadata();
  console.log(m.width, m.height);
})"
```
Expected: `300 360` (200 + 10 + 150).

- [ ] **Step 4: Manual browser check (drag interactions)**

Open `http://localhost:3000/` in a browser and verify:
1. Drop several screenshots → thumbnails appear with order badges.
2. Drag a card onto another → order changes; preview updates.
3. Drag a trim handle on a card → shaded region grows; preview shrinks accordingly; handle cannot cross the opposite handle.
4. Switch 方向 to 横向 → trims reset, preview becomes a row.
5. 生成长图 → progress shows, result image appears with a working 下载长图 link.
6. Add a 25MB file → rejected with a toast, not uploaded.

- [ ] **Step 5: Stop the server and commit any fixes**

```bash
kill %1
```
If the smoke test exposed bugs, fix them with targeted commits (`fix(...)`), re-running the relevant test suites.

---

## Future Seam (do not build now)

Auto overlap-detection later becomes `server/src/lib/overlap-detector.js`: given decoded buffers, it returns adjusted `items` trim values that are then fed to the existing `stitch()`. No API or frontend changes required beyond a toggle. YAGNI for v1.
