import { describe, expect, test } from 'bun:test';
import {
  createSyncAuthMessage,
  createSyncAuthReadyMessage,
  parseSyncAuthMessage,
} from './sync-auth-message';

describe('sync auth wire handshake', () => {
  test('parses authenticated and anonymous first messages', () => {
    expect(parseSyncAuthMessage({ type: 'sync.auth', token: 'access-token' }))
      .toEqual({ matched: true, ok: true, token: 'access-token' });
    expect(parseSyncAuthMessage(JSON.stringify({ type: 'sync.auth' })))
      .toEqual({ matched: true, ok: true });
  });

  test('does not consume normal sync messages', () => {
    expect(parseSyncAuthMessage({ type: 'sync.subscribe', tables: [] }))
      .toEqual({ matched: false });
  });

  test('rejects malformed bearer values', () => {
    expect(parseSyncAuthMessage({ type: 'sync.auth', token: 42 }))
      .toEqual({ matched: true, ok: false });
    expect(parseSyncAuthMessage({ type: 'sync.auth', token: '' }))
      .toEqual({ matched: true, ok: false });
  });

  test('creates stable client and server messages', () => {
    expect(createSyncAuthMessage('access-token')).toEqual({
      type: 'sync.auth',
      token: 'access-token',
    });
    expect(createSyncAuthMessage(null)).toEqual({ type: 'sync.auth' });
    expect(createSyncAuthReadyMessage(true)).toEqual({
      type: 'sync.auth.ready',
      authenticated: true,
    });
  });
});
