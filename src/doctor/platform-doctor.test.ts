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

  test('checks AI provider readiness, aliases, and status endpoint access', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: false,
      ai: {
        autoDetect: false,
        providers: {
          local: { type: 'openai-compatible', apiKey: 'test-key' },
          groq: { type: 'groq', apiKey: 'test-key' },
          bespoke: { type: 'custom', apiKey: 'test-key' },
        },
        aliases: {
          fast: 'local/model',
          smart: 'not-qualified',
          image: 'groq/image-model',
          speech: 'missing/tts',
        },
        statusEndpoint: { enabled: true, read: 'admin' },
      },
    }, { env: { NODE_ENV: 'production' } });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'ai.provider.base_url_missing')).toBe(true);
    expect(hasFinding(report, 'ai.provider.custom_adapter_missing')).toBe(true);
    expect(hasFinding(report, 'ai.alias.provider_inactive')).toBe(true);
    expect(hasFinding(report, 'ai.alias.invalid_model_reference')).toBe(true);
    expect(hasFinding(report, 'ai.alias.capability_unsupported')).toBe(true);
    expect(hasFinding(report, 'ai.alias.provider_missing')).toBe(true);
    expect(hasFinding(report, 'ai.status_endpoint.requires_auth')).toBe(true);
  });

  test('checks vector paths, metadata index guidance, and embedding readiness', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        docs: { id: 'text primary key' },
      },
      auth: false,
      storageDir: './.storage',
      vector: {
        defaultIndex: 'docs',
        indexes: {
          docs: {
            dimensions: 768,
            path: './.storage/vectors',
            readOnly: true,
            metadata: {
              bucket: { type: 'string', indexed: false },
            },
          },
          copy: {
            dimensions: 768,
            path: './.storage/vectors',
          },
          build: {
            dimensions: 8192,
            path: './.build/vector',
            metadata: {
              tenantId: { type: 'string', indexed: false },
            },
          },
        },
      },
    }, { env: {} });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'storage.auth_required')).toBe(true);
    expect(hasFinding(report, 'vector.ai.disabled')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_duplicate')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_overlaps_storage')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_overlaps_build_output')).toBe(true);
    expect(hasFinding(report, 'vector.index.read_only')).toBe(true);
    expect(hasFinding(report, 'vector.index.dimensions_high')).toBe(true);
    expect(hasFinding(report, 'vector.metadata.scope_field_unindexed')).toBe(true);
  });

  test('checks auth login routes and production observability readiness', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: true,
      email: false,
      loginPath: '/signin',
      publicPaths: ['/login', '/forgot-password'],
      observability: false,
    }, { env: { NODE_ENV: 'production' } });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'auth.login_path.not_public')).toBe(true);
    expect(hasFinding(report, 'observability.disabled.production')).toBe(true);
  });
});

function hasFinding(
  report: ReturnType<typeof runPlatformDoctor>,
  code: string
): boolean {
  return report.findings.some((finding) => finding.code === code);
}
