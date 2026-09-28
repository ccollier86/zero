import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import {
  AuthTenantInvitationEnvelope,
  TenantInvitationEnvelopeError,
} from './auth-tenant-invitation-envelope';

const active: ReactiveDB[] = [];

afterEach(() => {
  for (const db of active.splice(0)) db.dispose();
});

describe('tenant invitation envelope key boundary', () => {
  test('binds ciphertext to AAD and atomically rewraps DEKs during operator-key rotation', () => {
    const db = createReactiveDB({ mode: 'memory' });
    active.push(db);
    defineAuthTables(db);
    const oldKey = testKey(0);
    const newKey = testKey(32);
    const oldEnvelope = new AuthTenantInvitationEnvelope(db, oldKey);
    const ciphertext = oldEnvelope.encrypt('zinv_secret', 'job:invite:recipient');
    expect(oldEnvelope.decrypt(ciphertext, 'job:invite:recipient')).toBe('zinv_secret');
    expect(() => oldEnvelope.decrypt(ciphertext, 'job:other:recipient'))
      .toThrow(TenantInvitationEnvelopeError);

    expect(() => new AuthTenantInvitationEnvelope(db, newKey))
      .toThrow('previousEncryptionKeys');
    const rotated = new AuthTenantInvitationEnvelope(db, newKey, [oldKey]);
    expect(rotated.decrypt(ciphertext, 'job:invite:recipient')).toBe('zinv_secret');
    // Rewrap completed in the constructor; the old key is no longer required.
    const restarted = new AuthTenantInvitationEnvelope(db, newKey);
    expect(restarted.decrypt(ciphertext, 'job:invite:recipient')).toBe('zinv_secret');
    expect(() => new AuthTenantInvitationEnvelope(db, oldKey))
      .toThrow('previousEncryptionKeys');
  });

  test('rejects malformed or low-entropy wrapping-key encodings', () => {
    const db = createReactiveDB({ mode: 'memory' });
    active.push(db);
    defineAuthTables(db);
    expect(() => new AuthTenantInvitationEnvelope(db, 'correct horse battery staple'))
      .toThrow('base64url-encoded 32-byte key');
    expect(() => new AuthTenantInvitationEnvelope(db, 'A'.repeat(42)))
      .toThrow('base64url-encoded 32-byte key');
    expect(() => new AuthTenantInvitationEnvelope(
      db,
      Buffer.alloc(32).toString('base64url'),
    )).toThrow('repeated or placeholder');
    expect(() => new AuthTenantInvitationEnvelope(
      db,
      Buffer.from(Array.from({ length: 32 }, (_, index) => index % 8))
        .toString('base64url'),
    )).toThrow('repeated or placeholder');
  });
});

function testKey(offset: number): string {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (
    (index + offset) % 256
  ))).toString('base64url');
}
