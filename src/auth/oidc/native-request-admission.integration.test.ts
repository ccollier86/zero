import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hashToken } from '../../tokens/token-utils';
import { createReactiveDB } from '../../sync/reactive-db';
import { createAuthPlugin } from '../auth.plugin';
import { derivePkceS256Challenge } from '../native';

test('native authorize applies deployment source admission across public client requests', async () => {
  const db = createReactiveDB({ mode: 'memory' });
  const redirectUri = 'com.example.desktop:/callback';
  const app = new Elysia().use(createAuthPlugin({
    db, nativeIssuer: 'http://localhost/auth',
    nativeApps: {
      requestAdmission: {
        maxOutstandingGlobal: 20, maxOutstandingPerClient: 20,
        maxOutstandingPerSource: 1, maxAdmissionsGlobal: 20,
        maxAdmissionsPerClient: 20, maxAdmissionsPerSource: 1,
        sourceKey: ({ request }) => request.headers.get('x-trusted-source'),
      },
      clients: [{ clientId: 'desktop', name: 'Desktop', redirectUris: [redirectUri] }],
    },
  }));
  app.listen(0);
  const base = `http://localhost:${app.server!.port}`;
  try {
    const query = new URLSearchParams({
      response_type: 'code', client_id: 'desktop', redirect_uri: redirectUri,
      scope: 'openid', state: 's'.repeat(43), nonce: 'n'.repeat(43),
      code_challenge: await derivePkceS256Challenge('v'.repeat(64)),
      code_challenge_method: 'S256',
    });
    const authorize = (source: string) => fetch(`${base}/auth/oauth/authorize?${query}`, {
      redirect: 'manual', headers: { 'x-trusted-source': source },
    });
    expect((await authorize('edge:203.0.113.1')).headers.get('location')).toStartWith('/login');
    const limited = new URL((await authorize('edge:203.0.113.1')).headers.get('location')!);
    expect(limited.origin).toBe('null');
    expect(limited.searchParams.get('error')).toBe('temporarily_unavailable');
    expect((await authorize('edge:203.0.113.2')).headers.get('location')).toStartWith('/login');
    const hashes = db.prepare('SELECT source_hash FROM _auth_native_requests').all() as any[];
    expect(hashes).toHaveLength(2);
    expect(hashes.some((row) => row.source_hash === 'edge:203.0.113.1')).toBe(false);
    expect(hashes.some((row) => row.source_hash === hashToken('edge:203.0.113.1'))).toBe(false);
  } finally {
    await app.stop();
    db.dispose();
  }
});
