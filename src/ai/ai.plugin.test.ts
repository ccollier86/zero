import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { resolveAIConfig } from './ai-env';
import { createAIPlugin } from './ai.plugin';

describe('createAIPlugin', () => {
  test('does not expose AI routes by default', async () => {
    const config = resolveAIConfig(true, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const app = new Elysia().use(createAIPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/ai/status'));

    expect(response.status).toBe(404);
  });

  test('exposes provider status in development mode when explicitly enabled', async () => {
    const config = resolveAIConfig({
      statusEndpoint: { enabled: true },
    }, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const app = new Elysia().use(createAIPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/ai/status'));
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.providers.find((provider: any) => provider.id === 'openai')).toMatchObject({
      active: true,
      configuredBy: ['OPENAI_API_KEY'],
    });
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  test('requires admin access when the optional status endpoint is enabled with auth', async () => {
    const config = resolveAIConfig({
      statusEndpoint: { enabled: true },
    }, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const anonymous = new Elysia().use(createAIPlugin({ config, authEnabled: true }));
    const denied = await anonymous.handle(new Request('http://localhost/api/_zero/ai/status'));
    expect(denied.status).toBe(403);

    const admin = new Elysia()
      .resolve({ as: 'global' }, () => ({
        authContext: { userId: 'admin-1', email: 'admin@test.local', role: 'admin' },
      }))
      .use(createAIPlugin({ config, authEnabled: true }));

    const allowed = await admin.handle(new Request('http://localhost/api/_zero/ai/status'));
    expect(allowed.status).toBe(200);
  });
});
