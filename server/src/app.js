import Fastify from 'fastify';
import multipart from '@fastify/multipart';

const MAX_FILES = 30;
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

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
