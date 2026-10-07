/** Parent-bound page-proof rotation, malformed-claim and late-issuance regressions. */
import { expect, test } from 'bun:test';
import { CompactSign, SignJWT } from 'jose';
import { loadOrCreateAuthSigningKeys } from './auth-signing-keys';
import { contactFixture } from './auth-user-contact.test-fixture';
import { hashToken } from '../tokens/token-utils';
import { setPageSessionCookie } from './page-session';

test('ordinary HTTP refresh preserves the exact parent for both old and renewed page proofs', async () => {
  const f = contactFixture({ profile: {} });
  try {
    const signed = await f.register(); const tokens = f.getRuntime().getTokenService()!;
    const page = (await tokens.issuePageSessionToken(signed.refreshToken))!;
    const original = (await tokens.resolvePageSessionToken(page.token))!;
    const refreshed = await f.app.handle(new Request('https://example.test/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${tokens.pageSessionCookieName}=${page.token}` },
      body: JSON.stringify({ refreshToken: signed.refreshToken }),
    }));
    expect(refreshed.status).toBe(200);
    const pair = await refreshed.json() as { accessToken: string; refreshToken: string };
    const header = refreshed.headers.getSetCookie().find(value => value.startsWith(`${tokens.pageSessionCookieName}=`))!;
    expect(header).not.toContain('Max-Age=0');
    const renewed = header.split(';', 1)[0]!.slice(tokens.pageSessionCookieName.length + 1);
    const oldPage = await tokens.resolvePageSessionToken(page.token), newPage = await tokens.resolvePageSessionToken(renewed);
    expect(oldPage).toMatchObject({ sessionId: original.sessionId, sessionGeneration: original.sessionGeneration });
    expect(newPage).toMatchObject({ sessionId: original.sessionId, sessionGeneration: original.sessionGeneration });
    await expect(tokens.resolveAuthContext(pair.accessToken)).resolves.toMatchObject({ sessionId: original.sessionId });
    expect(tokens.resolveWebRefreshProof(pair.refreshToken)?.session.sessionId).toBe(original.sessionId);
    expect(await tokens.revokePageSessionToken(page.token)).toBe(true);
    await expect(tokens.resolvePageSessionToken(renewed)).resolves.toBeNull();
    await expect(tokens.resolveAuthContext(pair.accessToken)).resolves.toBeNull();
  } finally { await f.close(); }
});

test('original child-bound format remains strict after its refresh child is consumed', async () => {
  const f = contactFixture({ profile: {} });
  try {
    const signed = await f.register(), tokens = f.getRuntime().getTokenService()!, store = f.getRuntime().getStore()!;
    const keys = await loadOrCreateAuthSigningKeys({ db: f.db });
    const record = store.getRefreshTokenByHash(hashToken(signed.refreshToken))!;
    const legacy = await new SignJWT({ sid: record.tokenId, authGeneration: store.getAuthGeneration(signed.user.userId) })
      .setProtectedHeader({ alg: 'ES256', kid: keys.keyId }).setSubject(signed.user.userId)
      .setIssuedAt().setExpirationTime('1h').setIssuer('auth-page-session').sign(keys.privateKey);
    await expect(tokens.resolvePageSessionToken(legacy)).resolves.toMatchObject({ sessionId: record.sessionId });
    expect(await tokens.rotateRefreshToken(signed.refreshToken)).not.toBeNull();
    await expect(tokens.resolvePageSessionToken(legacy)).resolves.toBeNull();
    await expect(tokens.revokePageSessionToken(legacy)).resolves.toBe(false);
  } finally { await f.close(); }
});

test('versioned parent proofs reject unknown formats and invalid mandatory generations', async () => {
  const f = contactFixture({ profile: {} });
  try {
    const signed = await f.register(), tokens = f.getRuntime().getTokenService()!, store = f.getRuntime().getStore()!;
    const keys = await loadOrCreateAuthSigningKeys({ db: f.db });
    const authority = (await tokens.resolveAuthContext(signed.accessToken))!;
    const base = { pageSessionVersion: 2, sid: authority.sessionId, sessionGeneration: authority.sessionGeneration,
      authGeneration: store.getAuthGeneration(signed.user.userId) };
    const sign = (claims: Record<string, unknown>) => new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: keys.keyId }).setSubject(signed.user.userId)
      .setIssuedAt().setExpirationTime('1h').setIssuer('auth-page-session').sign(keys.privateKey);
    await expect(tokens.resolvePageSessionToken(await sign(base))).resolves.toMatchObject({ sessionId: authority.sessionId });
    const invalid: Record<string, unknown>[] = [
      ...[1, 3, '2', null].map(pageSessionVersion => ({ ...base, pageSessionVersion })),
      ...[undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0'].map(sessionGeneration => ({ ...base, sessionGeneration })),
      ...[undefined, null, -1, 0.5, '0'].map(authGeneration => ({ ...base, authGeneration })),
      { ...base, sessionGeneration: authority.sessionGeneration! + 1 },
      { ...base, authGeneration: base.authGeneration + 1 },
      { ...base, sid: 'ses_nonexistent' }, { ...base, sid: '' },
      { ...base, pageSessionVersion: undefined },
    ];
    for (const claims of invalid) await expect(tokens.resolvePageSessionToken(await sign(claims))).resolves.toBeNull();
  } finally { await f.close(); }
});

for (const parentBound of [true, false]) test(
  `${parentBound ? 'versioned parent' : 'legacy child'} page proof requires supported signed expiry and page-only cryptography`,
  async () => {
    const f = contactFixture({ profile: {} });
    try {
      const signed = await f.register(), tokens = f.getRuntime().getTokenService()!, store = f.getRuntime().getStore()!;
      const keys = await loadOrCreateAuthSigningKeys({ db: f.db });
      const authority = (await tokens.resolveAuthContext(signed.accessToken))!;
      const record = store.getRefreshTokenByHash(hashToken(signed.refreshToken))!;
      const now = Math.floor(Date.now() / 1000);
      const base = {
        sid: parentBound ? authority.sessionId : record.tokenId,
        ...(parentBound ? { pageSessionVersion: 2, sessionGeneration: authority.sessionGeneration } : {}),
        authGeneration: store.getAuthGeneration(signed.user.userId),
        sub: signed.user.userId, iss: 'auth-page-session', iat: now,
      };
      const sign = (claims: Record<string, unknown>) => new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: keys.keyId }).sign(keys.privateKey);
      const valid = await sign({ ...base, exp: now + 3600 });
      await expect(tokens.resolvePageSessionToken(valid)).resolves.toMatchObject({ sessionId: authority.sessionId });
      for (const exp of [undefined, now - 10, null, 'future', Number.MAX_SAFE_INTEGER + 1, now + 3600.5]) {
        const token = await sign({ ...base, exp });
        await expect(tokens.resolvePageSessionToken(token)).resolves.toBeNull();
        await expect(tokens.revokePageSessionToken(token)).resolves.toBe(false);
      }
      // JSON numeric overflow can decode to Infinity without SignJWT's normal
      // serializer emitting null. Give it a genuine signature, then fail closed.
      const overflow = await new CompactSign(new TextEncoder().encode(`${JSON.stringify(base).slice(0, -1)},"exp":1e309}`))
        .setProtectedHeader({ alg: 'ES256', kid: keys.keyId }).sign(keys.privateKey);
      await expect(tokens.resolvePageSessionToken(overflow)).resolves.toBeNull();
      await expect(tokens.resolvePageSessionToken(await sign({ ...base, exp: now + 3600, iss: 'auth' }))).resolves.toBeNull();
      const wrongAlgorithm = await new SignJWT({ ...base, exp: now + 3600 })
        .setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
      await expect(tokens.resolvePageSessionToken(wrongAlgorithm)).resolves.toBeNull();
      await expect(tokens.resolvePageSessionToken(valid)).resolves.toMatchObject({ sessionId: authority.sessionId });
    } finally { await f.close(); }
  },
);

test('a page issuance losing to refresh rotation emits no cookie deletion or stale replacement', async () => {
  const f = contactFixture({ profile: {} });
  try {
    const signed = await f.register(), tokens = f.getRuntime().getTokenService()!;
    const page = (await tokens.issuePageSessionToken(signed.refreshToken))!;
    const codec = (tokens as unknown as { codec: { signPageSessionToken(input: unknown): Promise<string> } }).codec;
    const original = codec.signPageSessionToken.bind(codec);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    codec.signPageSessionToken = async input => { entered(); await gate; return original(input); };
    const set = { headers: {} };
    const pending = setPageSessionCookie(set, new Request('https://example.test/auth/refresh', {
      method: 'POST', headers: { Cookie: `${tokens.pageSessionCookieName}=${page.token}` },
    }), tokens, signed.refreshToken);
    try {
      await started;
      const rotated = await tokens.rotateRefreshToken(signed.refreshToken);
      expect(rotated).not.toBeNull(); release(); await pending;
      expect(set.headers).toEqual({});
      await expect(tokens.resolveAuthContext(rotated!.accessToken)).resolves.toMatchObject({ userId: signed.user.userId });
      await expect(tokens.resolvePageSessionToken(page.token)).resolves.toMatchObject({ userId: signed.user.userId });
    } finally { release(); codec.signPageSessionToken = original; await pending; }
  } finally { await f.close(); }
});
