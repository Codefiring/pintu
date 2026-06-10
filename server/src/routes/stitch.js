import Ajv from 'ajv';
import { stitch, StitchError } from '../lib/stitcher.js';

const MAX_FILES = 30; // duplicated in app.js multipart limits and the frontend by design
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

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          total += buf.length;
          if (total > MAX_TOTAL_SIZE) {
            reply.code(413).send({ error: 'TOTAL_TOO_LARGE' });
            req.raw.resume(); // discard the rest of the upload so the socket frees promptly
            return reply;
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
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        reply.code(413).send({ error: 'FILE_TOO_LARGE' });
        req.raw.resume();
        return reply;
      }
      if (err.code === 'FST_FILES_LIMIT') {
        reply.code(413).send({ error: 'TOO_MANY_FILES' });
        req.raw.resume();
        return reply;
      }
      throw err;
    }

    // !layout short-circuits; validateLayout.errors is null on success, an array on failure
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
