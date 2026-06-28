/**
 * platform-doctor.test.ts
 *
 * Verifies app-level doctor findings without invoking the CLI. These tests
 * keep diagnostic policy separate from terminal presentation.
 */

import { describe, expect, test } from 'bun:test';
import { runPlatformDoctor } from './platform-doctor';
import type { AppConfig } from '../frontend/server/types';

describe('runPlatformDoctor', () => {
  test('warns by default but only fails strict mode for warnings', () => {
    const config: AppConfig = {
      db: { mode: ':memory:' },
      tables: {
        todos: { id: 'text primary key', title: 'text not null' },
      },
      auth: true,
      email: false,
    };

    const relaxed = runPlatformDoctor(config, { env: {} });
    expect(relaxed.ok).toBe(true);
    expect(hasFinding(relaxed, 'auth.email.disabled')).toBe(true);
    expect(hasFinding(relaxed, 'sync.auth_policy.open_app_tables')).toBe(true);

    const strict = runPlatformDoctor(config, { env: {}, strict: true });
    expect(strict.ok).toBe(false);
  });

  test('reports schema primary-key and natural-identity mistakes', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        missingPk: { name: 'text not null' },
        tooManyPk: {
          left_id: 'text primary key',
          right_id: 'text primary key',
        },
        badIdentity: {
          membership_id: 'text primary key',
          team_id: 'text not null',
          _identity: ['team_id', 'missing', 'membership_id'],
        },
      },
      auth: false,
    });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'schema.primary_key.missing')).toBe(true);
    expect(hasFinding(report, 'schema.primary_key.composite')).toBe(true);
    expect(hasFinding(report, 'schema.identity.missing_field')).toBe(true);
    expect(hasFinding(report, 'schema.identity.primary_key_field')).toBe(true);
  });

  test('checks account email readiness and Resend configuration', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      app: {},
      tables: {
        users: { id: 'text primary key' },
      },
      auth: {
        accountEmails: {
          adminCreatedUser: true,
          passwordReset: true,
        },
      },
      email: {},
    }, { env: {} });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'auth.email.public_url_missing')).toBe(true);
    expect(hasFinding(report, 'email.from_missing')).toBe(true);
    expect(hasFinding(report, 'email.resend_api_key_missing')).toBe(true);
  });

  test('fails invalid account email duration strings', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: {
        accountEmails: {
          actionTokenTTL: 'soon',
          requestCooldown: 'later',
        },
      },
      email: false,
    });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'auth.action_token_ttl.invalid')).toBe(true);
    expect(hasFinding(report, 'auth.account_email_cooldown.invalid')).toBe(true);
  });

  test('warns about file DB migration and lazy-table index guidance', () => {
    const report = runPlatformDoctor({
      db: { mode: './data/app.db' },
      migrate: false,
      tables: {
        audit_log: {
          serverTable: { audit_id: 'text primary key', created_at: 'integer not null' },
          clientTable: { _pk: 'audit_id', _sync: 'lazy', created_at: 'integer' },
        },
      },
      auth: false,
    });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'migrations.startup.disabled')).toBe(true);
    expect(hasFinding(report, 'sync.lazy.index_guidance')).toBe(true);
  });
});

function hasFinding(
  report: ReturnType<typeof runPlatformDoctor>,
  code: string
): boolean {
  return report.findings.some((finding) => finding.code === code);
}
