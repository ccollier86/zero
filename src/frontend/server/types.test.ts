/**
 * types.test.ts
 *
 * Verifies server app config normalization. These tests keep createApp's
 * backend contract explicit before plugins and HTTP routes are composed.
 */

import { describe, expect, test } from 'bun:test';
import { defineZeroConfig, resolveConfig } from './types';

const tables = {
  todos: {
    id: 'text primary key',
    title: 'text not null',
  },
};

describe('resolveConfig', () => {
  test('defineZeroConfig returns the same app config object', () => {
    const input = {
      db: { mode: 'memory' },
      tables,
      ai: false,
    } as const;

    const config = defineZeroConfig(input);

    expect(config).toBe(input);
    expect(config.ai).toBe(false);
  });

  test('allows state sync when auth is enabled', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      stateSync: true,
    });

    expect(config.auth).toEqual({});
    expect(config.stateSync).toBe(true);
    expect(config.syncAuth).toBe('required');
    expect(config.syncAuthDefaulted).toBe(true);
    expect(config.generatedDir).toBe('./.zero/generated');
    expect(config.serverPluginsDir).toBe('./server/plugins');
    expect(config.serverMiddlewareDir).toBe('./server/middleware');
    expect(config.serverEndpointsDir).toBe('./server/endpoints');
    expect(config.serverRoutesDir).toBe('./server/routes');
    expect(config.serverResourcesDir).toBe('./server/resources');
    expect(config.resourceRoutes).toEqual({});
    expect(config.routeAuth).toBe('protected-by-default');
    expect(config.postLoginPath).toBe('/');
    expect(config.workflows).toEqual({});
  });

  test('normalizes workflow registration and enforces its auth dependency', () => {
    const register = () => undefined;
    const configured = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      workflows: { register },
    });
    expect(configured.workflows).toEqual({ register });

    const disabled = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      workflows: false,
    });
    expect(disabled.workflows).toBe(false);

    expect(() => resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: false,
      workflows: { register },
    })).toThrow('workflows require auth: true');
  });

  test('supports explicit route auth for public-first apps', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      routeAuth: 'explicit',
    });

    expect(config.auth).not.toBe(false);
    expect(config.routeAuth).toBe('explicit');
  });

  test('defaults custom auth routes to public without changing explicit public paths', () => {
    const defaults = resolveConfig({
      db: { mode: 'memory' }, tables,
      auth: {
        account: { emailVerificationPath: 'confirm-email?source=registration' },
        accountEmails: {
          resetPath: '/recover-account?source=email',
          setupPath: 'activate-account#setup',
        },
      },
      loginPath: '/signin?mode=auth', registrationPath: '/join#register',
    });
    expect(defaults.publicPaths).toContain('/signin');
    expect(defaults.publicPaths).toContain('/join');
    expect(defaults.publicPaths).toContain('/confirm-email');
    expect(defaults.publicPaths).toContain('/recover-account');
    expect(defaults.publicPaths).toContain('/activate-account');
    expect(defaults.publicPaths).not.toContain('/signin?mode=auth');
    expect(defaults.publicPaths).not.toContain('/login');
    expect(defaults.publicPaths).not.toContain('/register');
    expect(defaults.publicPaths).not.toContain('/verify-email');
    expect(defaults.publicPaths).not.toContain('/reset-password');
    expect(defaults.publicPaths).not.toContain('/setup-password');

    const explicit = resolveConfig({
      db: { mode: 'memory' }, tables, auth: true,
      loginPath: '/signin', registrationPath: '/join', publicPaths: ['/health'],
    });
    expect(explicit.publicPaths).toEqual(['/health']);
  });

  test('rejects unsafe default auth page paths', () => {
    expect(() => resolveConfig({
      db: { mode: 'memory' }, tables,
      auth: { account: { emailVerificationPath: '//attacker.example/verify' } },
    })).toThrow('account.emailVerificationPath must be a safe local path');
  });

  test('normalizes and validates the authenticated post-login destination', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      loginPath: 'signin?mode=password',
      postLoginPath: 'dashboard?tab=home#today',
    });

    expect(config.loginPath).toBe('/signin?mode=password');
    expect(config.postLoginPath).toBe('/dashboard?tab=home#today');

    expect(() => resolveConfig({
      db: { mode: 'memory' }, tables, auth: true,
      postLoginPath: 'https://attacker.example/dashboard',
    })).toThrow('postLoginPath must be a safe local path');

    expect(() => resolveConfig({
      db: { mode: 'memory' }, tables, auth: true,
      loginPath: '/signin/', postLoginPath: '/signin',
    })).toThrow('postLoginPath must not resolve to loginPath');

    expect(resolveConfig({
      db: { mode: 'memory' }, tables, auth: true, loginPath: '/',
    }).postLoginPath).toBe('/');
  });

  test('defaults authless apps to explicit route auth', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: false,
    });

    expect(config.auth).toBe(false);
    expect(config.routeAuth).toBe('explicit');
    expect(config.syncAuth).toBe('public');
    expect(config.syncAuthDefaulted).toBe(false);
  });

  test('preserves deliberate public sync for an auth-enabled app', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      syncAuth: 'public',
    });

    expect(config.syncAuth).toBe('public');
    expect(config.syncAuthDefaulted).toBe(false);
  });

  test('rejects required sync auth when app auth is disabled', () => {
    expect(() => resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: false,
      syncAuth: 'required',
    })).toThrow("[app] syncAuth: 'required' requires auth: true");
  });

  test('keeps sitemap disabled by default', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
    });

    expect(config.sitemap).toBe(false);
  });

  test('keeps PDF disabled by default and resolves secure PDF config when enabled', () => {
    const disabled = resolveConfig({ db: { mode: 'memory' }, tables }, {});
    expect(disabled.pdf).toBe(false);

    const enabled = resolveConfig({
      db: { mode: 'memory' },
      tables,
      pdf: true,
    }, {});
    expect(enabled.pdf).not.toBe(false);
    if (enabled.pdf !== false) {
      expect(enabled.pdf.resources.remote).toBe('deny');
      expect(enabled.pdf.browser.javaScriptEnabled).toBe(false);
    }
  });

  test('normalizes enabled sitemap config', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      sitemap: {
        path: 'site-map.xml',
        changefreq: 'weekly',
        priority: 0.6,
        entries: [{ href: '/blog/first-post' }],
        exclude: ['/dashboard'],
      },
    });

    expect(config.sitemap).toEqual({
      path: '/site-map.xml',
      changefreq: 'weekly',
      priority: 0.6,
      entries: [{ href: '/blog/first-post' }],
      exclude: ['/dashboard'],
    });
  });

  test('normalizes sitemap boolean and object disable', () => {
    const enabled = resolveConfig({
      db: { mode: 'memory' },
      tables,
      sitemap: true,
    });
    expect(enabled.sitemap).not.toBe(false);
    if (enabled.sitemap !== false) {
      expect(enabled.sitemap.path).toBe('/sitemap.xml');
      expect(enabled.sitemap.entries).toEqual([]);
      expect(enabled.sitemap.exclude).toEqual([]);
    }

    expect(resolveConfig({
      db: { mode: 'memory' },
      tables,
      sitemap: { enabled: false },
    }).sitemap).toBe(false);
  });

  test('preserves auth registration and user property config', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: {
        registration: { mode: 'admin-only' },
        account: {
          requireEmailVerification: true,
          emailVerificationPath: '/verify-email',
        },
        mfa: {
          enabled: true,
          policy: 'required',
          methods: ['totp'],
          totp: {
            issuer: 'Zero CRM',
            encryptionKey: 'secret',
          },
        },
        accountEmails: {
          adminCreatedUser: true,
          passwordReset: true,
          actionTokenTTL: '2h',
        },
        nativeApps: {
          clients: [{
            clientId: 'com.example.desktop',
            name: 'Example Desktop',
            redirectUris: ['com.example.desktop:/oauth/callback'],
          }],
        },
        branding: {
          appName: 'Zero CRM Auth',
          brandColor: '#155eef',
        },
        emails: {
          passwordReset: (ctx) => ({
            subject: ctx.defaultSubject,
            text: ctx.defaultText,
            html: ctx.defaultHtml,
          }),
        },
        userProperties: {
          department: {
            type: 'enum',
            values: ['accounting', 'operations'],
            editableBy: 'admin',
            useInPolicies: true,
          },
        },
      },
    });

    expect(config.auth).not.toBe(false);
    if (config.auth !== false) {
      expect(config.auth.registration?.mode).toBe('admin-only');
      expect(config.auth.account?.requireEmailVerification).toBe(true);
      expect(config.auth.account?.emailVerificationPath).toBe('/verify-email');
      expect(config.auth.mfa?.enabled).toBe(true);
      expect(config.auth.mfa?.policy).toBe('required');
      expect(config.auth.mfa?.methods).toEqual(['totp']);
      expect(config.auth.mfa?.totp?.issuer).toBe('Zero CRM');
      expect(config.auth.accountEmails?.adminCreatedUser).toBe(true);
      expect(config.auth.accountEmails?.actionTokenTTL).toBe('2h');
      expect(config.auth.nativeApps?.clients?.[0]?.clientId).toBe('com.example.desktop');
      expect(config.auth.branding?.appName).toBe('Zero CRM Auth');
      expect(typeof config.auth.emails?.passwordReset).toBe('function');
      expect(config.auth.userProperties?.department.values).toEqual([
        'accounting',
        'operations',
      ]);
      expect(config.auth.userProperties?.department.useInPolicies).toBe(true);
    }
  });

  test('preserves app identity and email config', () => {
    const config = resolveConfig({
      app: {
        name: 'Zero CRM',
        publicUrl: 'https://crm.example.com',
      },
      db: { mode: 'memory' },
      tables,
      email: {
        from: 'Zero CRM <noreply@example.com>',
        provider: 'resend',
        resend: {
          apiKey: 'test_key',
        },
      },
    });

    expect(config.app.name).toBe('Zero CRM');
    expect(config.app.publicUrl).toBe('https://crm.example.com');
    expect(config.email).not.toBe(false);
    if (config.email !== false) {
      expect(config.email.from).toBe('Zero CRM <noreply@example.com>');
      expect(config.email.provider).toBe('resend');
      expect(config.email.resend?.apiKey).toBe('test_key');
    }
  });

  test('resolves vector config when enabled', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      vector: {
        dataDir: './vectors',
        defaultIndex: 'docs',
        indexes: {
          docs: {
            dimensions: 768,
            metadata: {
              bucket: 'string',
            },
          },
        },
      },
    });

    expect(config.vector).not.toBe(false);
    if (config.vector !== false) {
      expect(config.vector.defaultIndex).toBe('docs');
      expect(config.vector.indexes.docs.dimensions).toBe(768);
      expect(config.vector.indexes.docs.metadata.bucket.type).toBe('string');
    }
  });

  test('rejects state sync when auth is omitted', () => {
    expect(() =>
      resolveConfig({
        db: { mode: 'memory' },
        tables,
        stateSync: true,
      })
    ).toThrow('[app] stateSync requires auth: true');
  });

  test('rejects state sync when auth is explicitly disabled', () => {
    expect(() =>
      resolveConfig({
        db: { mode: 'memory' },
        tables,
        auth: false,
        stateSync: true,
      })
    ).toThrow('[app] stateSync requires auth: true');
  });

  test('defaults omitted table sync mode to auto', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
    });

    expect(config.declaredSyncModes.get('todos')).toBe('auto');
    expect(config.syncDefaults.defaultMode).toBe('auto');
    expect(config.syncDefaults.rowLimit).toBe(1000);
    expect(config.syncDefaults.action).toBe('lazy');
    expect(config.syncDefaults.persist).toBe(true);
  });

  test('preserves explicit table sync modes and config overrides', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables: {
        lazy_docs: {
          serverTable: { id: 'text primary key', title: 'text not null' },
          clientTable: { _pk: 'id', _sync: 'lazy', id: 'text', title: 'text' },
        },
        large_docs: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      syncDefaults: {
        tables: {
          large_docs: { mode: 'full', rowLimit: 50, action: 'warn', persist: false },
        },
      },
    });

    expect(config.declaredSyncModes.get('lazy_docs')).toBe('lazy');
    expect(config.declaredSyncModes.get('large_docs')).toBe('full');
    expect(config.lazyTables.has('lazy_docs')).toBe(true);
    expect(config.snapshotTables.has('large_docs')).toBe(true);
    expect(config.syncDefaults.tables.get('large_docs')).toEqual({
      mode: 'full',
      rowLimit: 50,
      action: 'warn',
      persist: false,
    });
  });

  test('preserves generated resource route config', () => {
    expect(resolveConfig({
      db: { mode: 'memory' },
      tables,
      resourceRoutes: false,
    }).resourceRoutes).toBe(false);

    expect(resolveConfig({
      db: { mode: 'memory' },
      tables,
      resourceRoutes: {
        prefix: '/api/domain',
        defaultLimit: 25,
        maxLimit: 100,
      },
    }).resourceRoutes).toEqual({
      prefix: '/api/domain',
      defaultLimit: 25,
      maxLimit: 100,
    });
  });
});
