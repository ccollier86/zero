/** Synthetic, isolated Guardian fixture; no environment/provider/network lookup. */
import { Elysia } from 'elysia';
import { EmailService } from '../email/email-service';
import { MemoryEmailProvider } from '../email/memory-email-provider';
import { MemoryEventStore } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin } from './auth.plugin';
import type { AuthRuntime } from './auth-runtime';
import type { AuthUserProfileConfig } from './auth-user-profile-types';
import type { PhoneVerificationAdapter } from './auth-user-contact-types';
import type { AuthPluginConfig } from './types';

export function contactFixture(options: { profile?: AuthUserProfileConfig; schemaAllowed?: boolean;
  adapter?: PhoneVerificationAdapter; provider?: MemoryEmailProvider; emailEnabled?: boolean; db?: ReactiveDB;
  completionSchemaAllowed?: boolean;
  disposeDbOnClose?: boolean;
  auth?: Pick<AuthPluginConfig, 'tenancy' | 'authorization' | 'mfa' | 'registration' | 'account'> } = {}) {
  const db = options.db ?? createReactiveDB({ mode: 'memory' });
  const owner = new ZeroAppRuntime('contact-test');
  const events = new MemoryEventStore({ maxEvents: 500 });
  owner.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  const provider = options.provider ?? new MemoryEmailProvider();
  const email = { enabled: options.emailEnabled !== false, app: { name: 'Contact test', publicUrl: 'https://example.test' },
    config: { provider, from: 'no-reply@example.test' }, provider,
    service: new EmailService(provider, { from: 'no-reply@example.test' }) };
  let runtime!: AuthRuntime;
  const app = new Elysia().use(createAuthPlugin({ db, runtime: owner, emailRuntime: email,
    bootstrap: 'public', profileContactSchemaInstallAllowed: options.schemaAllowed,
    profileCompletionSchemaInstallAllowed: options.completionSchemaAllowed,
    phoneVerificationAdapter: options.adapter, account: { allowAdminMarkEmailVerified: true },
    userProfile: options.profile ?? { contacts: { enabled: true, email: { verify: true, change: true },
      phone: { enabled: true, editable: true, verify: true }, resendCooldown: '1s' } },
    nativeIssuer: 'http://localhost/auth', nativeAudience: 'http://localhost',
    nativeApps: { clients: [{ clientId: 'contact-native', name: 'Contact Native',
      redirectUris: ['com.example.contact:/callback'], scopes: ['openid', 'profile', 'email', 'phone', 'contacts:write'] }] },
    ...options.auth, onRuntimeCreated: value => { runtime = value; } })).compile();
  const request = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await app.handle(new Request(`http://localhost${path}`, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  };
  const register = async (name = 'contact-owner') => {
    const response = await request('POST', '/auth/register', { username: name,
      email: `${name}@example.test`, password: 'password123' });
    if (response.status !== 200) throw new Error(`Synthetic contact registration failed: ${response.status} ${response.body.code}`);
    return response.body;
  };
  return { app, db, events, provider, request, register, getRuntime: () => runtime,
    async close() { await owner.dispose(); if (options.disposeDbOnClose !== false) db.dispose(); } };
}

export function deliveredContactToken(provider: MemoryEmailProvider): string {
  const message = [...provider.messages].reverse().find(item => item.message.tags?.action === 'contact_verification');
  const url = message?.message.text?.match(/https:\/\/example\.test\/verify-contact\?token=[A-Za-z0-9_-]+/)?.[0];
  if (!url) throw new Error('Synthetic contact email link was not captured');
  return new URL(url).searchParams.get('token')!;
}
