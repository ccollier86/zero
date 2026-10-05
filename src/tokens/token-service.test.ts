/**
 * token-service.test.ts
 *
 * Verifies generic platform action and resume token behavior without mounting
 * Elysia. Route/auth integrations are covered by their own subsystem tests.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  configureObservability,
  getPlatformEventStore,
  OBS_CODES,
} from '../observability';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { PlatformTokenError } from './token-types';
import { PlatformTokenService } from './token-service';
import { PlatformTokenStore } from './token-store';

let db: ReactiveDB;
let service: PlatformTokenService;

beforeEach(() => {
  configureObservability({ console: false });
  db = createReactiveDB({ mode: 'memory' });
  service = new PlatformTokenService(new PlatformTokenStore(db), {
    actionTokenTTL: '1h',
    resumeTokenTTL: '7d',
    actionTokenCooldown: '5m',
  });
});

afterEach(() => {
  db.dispose();
});

describe('PlatformTokenService action tokens', () => {
  test('treats the exact expiry deadline as expired for action and resume tokens', () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const action = service.createActionToken({ purpose: 'synthetic.action', ttl: '1s', cooldown: false });
      const resume = service.createResumeToken({ flow: 'synthetic.flow', resource: { type: 'draft', id: 'synthetic' }, ttl: '1s' });
      clock.mockReturnValue(action.record.expiresAt);
      expect(() => service.inspectActionToken(action.rawToken)).toThrow('expired');
      expect(() => service.consumeActionToken(action.rawToken)).toThrow('expired');
      expect(() => service.verifyResumeToken(resume.rawToken)).toThrow('expired');
      expect(() => service.rotateResumeToken(resume.rawToken)).toThrow('expired');
      expect(service.cleanupExpiredActionTokens()).toBe(1);
      expect(service.cleanupExpiredResumeTokens()).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  test('rejects malformed and unsafe lifetimes with structured errors before storing tokens', () => {
    for (const ttl of ['invalid', '999999999999999999999999999999999999999999d', '9007199254741s', '9007199254000s', 42 as unknown as string, {} as string]) {
      expect(() => service.createActionToken({ purpose: 'synthetic.action', ttl, cooldown: false })).toThrow(PlatformTokenError);
      expect(() => service.createResumeToken({ flow: 'synthetic.flow', resource: { type: 'draft', id: 'synthetic' }, ttl })).toThrow(PlatformTokenError);
    }
    expect((db.prepare('SELECT COUNT(*) AS count FROM _zero_action_tokens').get() as { count: number }).count).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS count FROM _zero_resume_tokens').get() as { count: number }).count).toBe(0);
  });

  test('creates opaque one-time tokens without exposing token hashes', () => {
    const created = service.createActionToken({
      purpose: 'email.verify',
      subject: { type: 'public-intake', id: 'draft_1' },
      scope: 'clinic-signup',
      metadata: { email: 'patient@example.com' },
    });

    expect(created.rawToken).toBeString();
    expect(created.record).not.toHaveProperty('tokenHash');
    expect(created.record.purpose).toBe('email.verify');
    expect(created.record.subject).toEqual({ type: 'public-intake', id: 'draft_1' });

    const row = db
      .prepare('SELECT token_hash FROM _zero_action_tokens WHERE token_id = ?')
      .get(created.record.tokenId) as { token_hash: string };
    expect(row.token_hash).not.toBe(created.rawToken);
  });

  test('inspects then consumes an action token exactly once', () => {
    const created = service.createActionToken({
      purpose: 'invite.accept',
      subject: { type: 'user', id: 'u_1' },
      cooldown: false,
    });

    expect(service.inspectActionToken(created.rawToken, {
      purposes: ['invite.accept'],
    }).tokenId).toBe(created.record.tokenId);

    const consumed = service.consumeActionToken(created.rawToken, {
      purposes: ['invite.accept'],
    });
    expect(consumed.consumedAt).toBeNumber();
    expect(getPlatformEventStore()?.query({
      code: OBS_CODES.TOKENS_ACTION_CREATED.code,
    }).events).toHaveLength(1);
    expect(getPlatformEventStore()?.query({
      code: OBS_CODES.TOKENS_ACTION_CONSUMED.code,
    }).events).toHaveLength(1);
    expect(() => service.consumeActionToken(created.rawToken, {
      purposes: ['invite.accept'],
    })).toThrow(PlatformTokenError);
  });

  test('rejects expired action tokens', () => {
    const created = service.createActionToken({
      purpose: 'email.verify',
      ttl: '1s',
      cooldown: false,
    });
    db.prepare('UPDATE _zero_action_tokens SET expires_at = ? WHERE token_id = ?')
      .run(Date.now() - 1, created.record.tokenId);

    expect(() => service.inspectActionToken(created.rawToken)).toThrow('Action token has expired');
  });

  test('enforces cooldown per purpose subject and scope', () => {
    service.createActionToken({
      purpose: 'email.verify',
      subject: { type: 'draft', id: 'a' },
      scope: 'clinic',
    });

    expect(() => service.createActionToken({
      purpose: 'email.verify',
      subject: { type: 'draft', id: 'a' },
      scope: 'clinic',
    })).toThrow('cooling down');

    const otherScope = service.createActionToken({
      purpose: 'email.verify',
      subject: { type: 'draft', id: 'a' },
      scope: 'billing',
    });
    expect(otherScope.record.scope).toBe('billing');
  });
});

describe('PlatformTokenService resume tokens', () => {
  test('verifies resume tokens repeatedly without consuming them', () => {
    const created = service.createResumeToken({
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_1' },
      subject: { type: 'email', id: 'patient@example.com' },
    });

    const first = service.verifyResumeToken(created.rawToken, {
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_1' },
    });
    const second = service.verifyResumeToken(created.rawToken, {
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_1' },
    });

    expect(first.tokenId).toBe(created.record.tokenId);
    expect(second.tokenId).toBe(created.record.tokenId);
    expect(second.lastUsedAt).toBeNumber();
  });

  test('rotates resume tokens and rejects the previous raw token', () => {
    const created = service.createResumeToken({
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_2' },
      metadata: { step: 'consents' },
    });

    const rotated = service.rotateResumeToken(created.rawToken, {
      flow: 'clinic-intake',
    });

    expect(rotated.rawToken).not.toBe(created.rawToken);
    expect(rotated.record.rotatedFrom).toBe(created.record.tokenId);
    expect(rotated.record.resource).toEqual(created.record.resource);
    expect(() => service.verifyResumeToken(created.rawToken)).toThrow('revoked');
    expect(service.verifyResumeToken(rotated.rawToken).tokenId).toBe(rotated.record.tokenId);
  });

  test('revokes resume tokens without deleting audit metadata immediately', () => {
    const created = service.createResumeToken({
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_3' },
    });

    expect(service.revokeResumeToken(created.rawToken)).toBe(true);
    expect(() => service.verifyResumeToken(created.rawToken)).toThrow('revoked');

    const row = db.prepare('SELECT revoked_at FROM _zero_resume_tokens WHERE token_id = ?')
      .get(created.record.tokenId) as { revoked_at: number | null };
    expect(row.revoked_at).toBeNumber();
  });

  test('revokes a resume token by its safe persisted token id', () => {
    const created = service.createResumeToken({
      flow: 'clinic-intake',
      resource: { type: 'intake-draft', id: 'draft_4' },
    });

    expect(service.revokeResumeTokenById(created.record.tokenId)).toBe(true);
    expect(service.revokeResumeTokenById(created.record.tokenId)).toBe(false);
    expect(() => service.verifyResumeToken(created.rawToken)).toThrow('revoked');
  });
});
