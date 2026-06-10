import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import stitchRoutes from './routes/stitch.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_FILES = 30; // duplicated in routes/stitch.js and the frontend by design
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

  app.register(stitchRoutes);

  const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  if (existsSync(distDir)) {
    app.register(fastifyStatic, { root: distDir });
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
