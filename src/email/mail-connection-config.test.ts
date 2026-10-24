import { expect, test } from 'bun:test';
import { inspectMailConnection } from './mail-connection-config';
import { emailFromEnv } from './email-from-env';
import { createEmailRuntime, isEmailDeliveryReady } from './runtime';
import { runPlatformDoctor } from '../doctor/platform-doctor';

test('SMTP/IMAP use secure inferred ports and explicit-over-env settings', () => {
  expect(inspectMailConnection('smtp', { host: 'smtp.test', port: 465 }, {}).settings).toMatchObject({ secure: true, port: 465, requireTLS: true });
  expect(inspectMailConnection('smtp', { host: 'smtp.test' }, {}).settings).toMatchObject({ secure: false, port: 587, requireTLS: true });
  expect(inspectMailConnection('imap', { host: 'imap.test', auth: { user: 'user', pass: 'password' } }, {}).settings).toMatchObject({ secure: true, port: 993 });
  const configured = inspectMailConnection('smtp', { host: 'explicit.test', auth: { user: 'explicit', pass: '' } }, { SMTP_HOST: 'ambient.test', SMTP_USER: 'ambient', SMTP_PASSWORD: 'ambient-password' });
  expect(configured.settings.host).toBe('explicit.test'); expect(configured.issues.map(value => value.field)).toContain('auth');
  expect(inspectMailConnection('smtp', { host: 'relay.test', auth: false }, { SMTP_USER: 'ambient', SMTP_PASSWORD: 'ambient-password' }).settings.auth).toBeUndefined();
  expect(inspectMailConnection('smtp', { host: 'smtp.test' }, {}).issues.map(issue => issue.field)).toContain('auth');
});

test('mail settings reject unsafe or malformed fields without reflecting their values', () => {
  for (const input of [{ port: 0 }, { port: 65536 }, { host: 'smtp://secret@host' }, { auth: { user: 'only-user' } }, { timeoutMs: Infinity }, { tls: { rejectUnauthorized: false } }]) {
    const resolved = inspectMailConnection('smtp', { host: 'smtp.test', ...input } as never, {});
    expect(resolved.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolved.issues)).not.toContain('secret');
  }
});

test('emailFromEnv keeps Resend compatibility, SMTP/IMAP optional, and explicit selection authoritative', async () => {
  expect(emailFromEnv({})).toBe(false);
  expect(emailFromEnv({ RESEND_API_KEY: 'test', SMTP_HOST: 'smtp.test' })).toMatchObject({ provider: 'resend' });
  expect(emailFromEnv({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test', SMTP_PORT: '465', SMTP_USER: 'user', SMTP_PASSWORD: 'pass', RESEND_API_KEY: 'test' })).toMatchObject({ provider: 'smtp', smtp: { port: 465, auth: { user: 'user', pass: 'pass' } } });
  expect(emailFromEnv({ IMAP_HOST: 'imap.test' })).toMatchObject({ provider: 'noop', imap: { host: 'imap.test' } });
  expect(emailFromEnv({ EMAIL_PROVIDER: 'false', SMTP_HOST: 'smtp.test', IMAP_HOST: 'imap.test' })).toBe(false);
  expect(() => emailFromEnv({ EMAIL_PROVIDER: 'smtp', SMTP_SECURE: 'maybe' })).toThrow('SMTP_SECURE');
  const runtime = createEmailRuntime({ provider: 'smtp', smtp: { host: 'relay.test', auth: false }, from: 'sender@example.test' }, {});
  expect(isEmailDeliveryReady(runtime)).toBe(true); expect(runtime.mailbox).toBeNull(); await runtime.close?.();
});

test('Doctor checks SMTP/IMAP with auth disabled and never leaks credentials', () => {
  const report = runPlatformDoctor({ db: { mode: 'memory' }, tables: {}, auth: false, email: {
    provider: 'smtp', smtp: { host: '', auth: { user: 'private@example.test', pass: '' } },
    imap: { host: 'imap.test', auth: { user: 'private@example.test', pass: '' } },
  } }, { env: {} });
  expect(report.ok).toBe(false);
  expect(report.findings.some(value => value.code === 'email.smtp.config_invalid')).toBe(true);
  expect(report.findings.some(value => value.code === 'email.imap.config_invalid')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('private@example.test');
});

test('Doctor admits required verification and email MFA through captured SMTP configuration', () => {
  const report = runPlatformDoctor({ db: { mode: 'memory' }, tables: {}, app: { publicUrl: 'https://app.example.test' },
    auth: { bootstrap: 'disabled', account: { requireEmailVerification: true }, mfa: { enabled: true, policy: 'required', methods: ['email'] } },
    email: { provider: 'smtp', from: 'sender@example.test', smtp: { host: 'smtp.example.test', port: 465, auth: { user: 'sender@example.test', pass: 'synthetic' } } },
  }, { env: {} });
  expect(report.findings.filter(finding => finding.code.endsWith('delivery_unavailable') || finding.code === 'email.smtp.config_invalid')).toEqual([]);
});

test('a captured environment map cannot inherit later ambient mail credentials or insecure settings', async () => {
  const config = emailFromEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'sender@example.test', SMTP_HOST: 'smtp.example.test' });
  const keys = ['SMTP_USER', 'SMTP_PASSWORD', 'SMTP_REQUIRE_TLS', 'SMTP_PORT'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.SMTP_USER = 'ambient'; process.env.SMTP_PASSWORD = 'ambient-secret'; process.env.SMTP_REQUIRE_TLS = 'false'; process.env.SMTP_PORT = '25';
    const runtime = createEmailRuntime(config, {});
    try { expect(isEmailDeliveryReady(runtime)).toBe(false); expect(config).toMatchObject({ smtp: { port: 587, secure: false, requireTLS: true, auth: { user: '', pass: '' } } }); }
    finally { await runtime.close?.(); }
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
