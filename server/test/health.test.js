import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/health', () => {
  let app;
  afterEach(() => app?.close());

  it('returns ok', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
