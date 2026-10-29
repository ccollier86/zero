import { expect, test } from 'bun:test';
import { isLoggingDocumentRequest } from './logging-document-request';

test('only document navigation or explicit HTML negotiation gets a document recovery representation', () => {
  const check = (headers: Record<string, string>, method = 'GET') => isLoggingDocumentRequest(new Request('https://example.test/private', { method, headers }));
  expect(check({ Accept: 'text/html,application/xhtml+xml;q=0.9' })).toBe(true);
  expect(check({ 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' })).toBe(true);
  expect(check({ 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' }, 'HEAD')).toBe(true);
  for (const destination of ['image', 'script', 'style', 'empty', 'font']) {
    expect(check({ 'Sec-Fetch-Dest': destination, Accept: 'text/html' })).toBe(false);
  }
  expect(check({ Accept: 'text/html;q=0,application/json' })).toBe(false);
  expect(check({ Accept: 'text/html;q=invalid' })).toBe(false);
  expect(check({ Accept: 'application/json' })).toBe(false);
  expect(check({})).toBe(false);
  expect(check({ Accept: 'text/html' }, 'POST')).toBe(false);
});
