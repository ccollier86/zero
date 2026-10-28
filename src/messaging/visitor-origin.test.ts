/** Origin/authority parser tests, not a substitute for native session authorization. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { resolveMessagingConfig } from './config';
import { MessagingVisitors } from './visitor-service';
import type { MessagingDependencies } from './service';

test('a configured HTTPS support origin works behind private HTTP TLS termination without trusting forwarded headers', () => {
  const config = resolveMessagingConfig({ support: { entries: { website: { origin: 'https://support.example.test' } } } }, '/synthetic', resolveAuthBehaviorConfig())!;
  const visitors = new MessagingVisitors({ config, directory: { assertScope() {} } } as unknown as MessagingDependencies);
  const request = (url: string, origin: string | null = 'https://support.example.test', extra: Record<string, string> = {}) => new Request(url, {
    method: 'POST', headers: { 'X-Zero-Support-Client': '1', ...(origin === null ? {} : { Origin: origin }), ...extra },
  });
  expect(() => visitors.requestEntry('website', request('http://support.example.test/api/messaging/public/website/session'), true)).not.toThrow();
  expect(() => visitors.requestEntry('website', request('https://support.example.test/api/messaging/public/website/session'), true)).not.toThrow();
  for (const rejected of [
    request('http://foreign.example.test/api/messaging/public/website/session'),
    request('http://support.example.test/api/messaging/public/website/session', 'http://support.example.test'),
    request('http://support.example.test/api/messaging/public/website/session', 'null'),
    request('http://support.example.test/api/messaging/public/website/session', null),
    request('http://127.0.0.1/api/messaging/public/website/session', 'https://support.example.test', { 'X-Forwarded-Host': 'support.example.test', 'X-Forwarded-Proto': 'https' }),
  ]) expect(() => visitors.requestEntry('website', rejected, true)).toThrow();
});
