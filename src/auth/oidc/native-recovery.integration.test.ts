import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { Elysia } from 'elysia';
import { configureEmail, MemoryEmailProvider } from '../../email';
import { createReactiveDB } from '../../sync/reactive-db';
import { createAuthMiddleware } from '../auth.middleware';
import { createAuthPlugin, getAuthEmailOutbox, getTokenService } from '../auth.plugin';

const clientId = 'com.example.recovery';
const redirectUri = 'com.example.recovery:/oauth/callback';

describe('native password recovery continuation', () => {
  test('returns a recovered user to the bound native authorization', async () => {
    const port = await availablePort();
    const baseUrl = `http://localhost:${port}`;
    const issuer = `${baseUrl}/auth`;
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <zero@example.test>', provider }, {
      name: 'Zero', publicUrl: baseUrl,
    });
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia()
      .use(createAuthPlugin({
        db, bootstrap: 'public', nativeIssuer: issuer, nativeAudience: baseUrl,
        accountEmails: { requestCooldown: '0s' },
        nativeApps: { clients: [{ clientId, name: 'Recovery App', redirectUris: [redirectUri] }] },
      }))
      .use(createAuthMiddleware(getTokenService));
    app.listen(port);
    try {
      await post(baseUrl, '/auth/register', {
        username: 'recover-native', email: 'recover-native@example.test',
        password: 'password123',
      });
      const attacker = await post(baseUrl, '/auth/register', {
        username: 'recovery-attacker', email: 'recovery-attacker@example.test',
        password: 'password123',
      });
      const attackerCookie = attacker.response.headers.get('set-cookie')!.split(';', 1)[0]!;

      const existingProbe = await startAuthorization(baseUrl, issuer);
      const existingResponse = await post(baseUrl, '/auth/forgot-password', {
        email: 'recover-native@example.test', nativeContinuation: existingProbe,
      });
      const unknownProbe = await startAuthorization(baseUrl, issuer);
      const unknownResponse = await post(baseUrl, '/auth/forgot-password', {
        email: 'missing-native@example.test', nativeContinuation: unknownProbe,
      });
      expect(existingResponse.data).toEqual({ ok: true });
      expect(unknownResponse.data).toEqual({ ok: true });
      expect((await approve(baseUrl, issuer, existingProbe, attackerCookie)).searchParams
        .get('code')).toBeString();
      expect((await approve(baseUrl, issuer, unknownProbe, attackerCookie)).searchParams
        .get('code')).toBeString();

      const continuation = await startAuthorization(baseUrl, issuer);

      const requested = await post(baseUrl, '/auth/forgot-password', {
        email: 'recover-native@example.test', nativeContinuation: continuation,
      });
      expect(requested.response.status).toBe(200);
      const actionUrl = firstUrl(provider.messages.at(-1)!.message.text);
      expect(actionUrl.searchParams.get('redirect')).toBe(continuation);

      const reset = await post(baseUrl, '/auth/reset-password', {
        token: actionUrl.searchParams.get('token'), newPassword: 'new-password123',
      });
      expect(reset.data).toMatchObject({ passwordUpdated: true, signInRequired: true });
      expect((await approve(baseUrl, issuer, continuation, attackerCookie)).searchParams
        .get('error')).toBe('access_denied');
      expect((await post(baseUrl, '/auth/login', {
        username: 'recover-native@example.test', password: 'password123',
      })).response.status).toBe(401);
      const login = await post(baseUrl, '/auth/login', {
        username: 'recover-native@example.test', password: 'new-password123',
      });
      const cookie = login.response.headers.get('set-cookie')!.split(';', 1)[0]!;
      const consent = await fetch(`${baseUrl}${continuation}`, { headers: { Cookie: cookie } });
      expect(consent.status).toBe(200);
      expect(await consent.text()).toContain('recover-native@example.test');
    } finally {
      await app.stop();
      db.dispose();
      configureEmail(false);
    }
  });
});

function authorizeQuery(): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'openid profile email', state: 's'.repeat(43), nonce: 'n'.repeat(43),
    code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
  });
}

async function startAuthorization(baseUrl: string, issuer: string): Promise<string> {
  const started = await fetch(`${issuer}/oauth/authorize?${authorizeQuery()}`, {
    redirect: 'manual',
  });
  return new URL(started.headers.get('location')!, baseUrl).searchParams.get('redirect')!;
}

async function approve(baseUrl: string, issuer: string, continuation: string, cookie: string) {
  const consent = await fetch(`${baseUrl}${continuation}`, {
    redirect: 'manual', headers: { Cookie: cookie },
  });
  if (consent.status === 302) return new URL(consent.headers.get('location')!);
  const response = await fetch(`${issuer}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { Cookie: cookie, Origin: baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: hidden(await consent.text()), decision: 'approve' }),
  });
  return new URL(response.headers.get('location')!);
}

async function post(base: string, path: string, body: object) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json() as any;
  if (path === '/auth/forgot-password') await getAuthEmailOutbox()?.processDue();
  return { response, data };
}

function firstUrl(text: string): URL {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Action URL missing');
  return new URL(match[0]);
}

function hidden(html: string): string {
  const match = html.match(/name="request_id" value="([^"]+)"/);
  if (!match) throw new Error('Request ID missing');
  return match[1]!;
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
