/**
 * auth-config.test.ts
 *
 * Verifies auth behavior config normalization and security validation. This
 * file owns pure config tests only; route payload behavior and user-property
 * writes are covered by integration and service tests.
 */

import { describe, expect, test } from 'bun:test';
import {
  defineAuthConfig,
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from './auth-config';
import type { AuthEmailTemplate } from './auth-email-templates';
import type {
  AuthAuthorizationMode,
  AuthBehaviorConfig,
  AuthTenancyMode,
  ResolvedAuthBehaviorConfig,
} from './types';

describe('resolveAuthBehaviorConfig', () => {
  test('normalizes existing auth config to the single/simple compatibility profile', () => {
    const defaults = resolveAuthBehaviorConfig();
    expect(defaults.tenancy).toEqual({
      mode: 'single',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'disabled' },
    });
    expect(defaults.authorization).toEqual({
      mode: 'simple',
      registryVersion: 1,
      permissions: {},
      roles: {},
    });
    expect(defaults.bootstrap).toEqual({ mode: 'secret' });

    const existing = resolveAuthBehaviorConfig({
      registration: { mode: 'admin-only' },
      strictUserProperties: true,
    });
    expect(existing.tenancy).toEqual({
      mode: 'single',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'disabled' },
    });
    expect(existing.authorization).toEqual({
      mode: 'simple',
      registryVersion: 1,
      permissions: {},
      roles: {},
    });
    expect(existing.registration.mode).toBe('admin-only');
    expect(existing.strictUserProperties).toBe(true);
  });

  test('normalizes explicit bootstrap modes and validates server-only secrets', () => {
    expect(resolveAuthBehaviorConfig({ bootstrap: 'public' }).bootstrap)
      .toEqual({ mode: 'public' });
    expect(resolveAuthBehaviorConfig({ bootstrap: 'disabled' }).bootstrap)
      .toEqual({ mode: 'disabled' });

    const secret = 'a-secure-bootstrap-secret-with-32-plus-characters';
    expect(resolveAuthBehaviorConfig({
      bootstrap: { mode: 'secret', secret },
    }).bootstrap).toEqual({ mode: 'secret', secret });

    expect(() => resolveAuthBehaviorConfig({
      bootstrap: { mode: 'secret', secret: 'too-short' },
    })).toThrow('Bootstrap secret must be at least 32 characters');
    expect(() => resolveAuthBehaviorConfig({
      bootstrap: { mode: 'secret', secret: 42 as never },
    })).toThrow('Bootstrap secret must be a string');
    expect(() => resolveAuthBehaviorConfig({
      bootstrap: { mode: 'public', secret },
    })).toThrow('Bootstrap secret may only be configured with bootstrap mode "secret"');
    expect(() => resolveAuthBehaviorConfig({
      bootstrap: 'open' as never,
    })).toThrow('Unsupported bootstrap mode: "open"');
  });

  test('rejects unknown auth fields and runtime primitive mismatches', () => {
    const invalid: Array<[unknown, string]> = [
      [null, 'Auth config must be an object'],
      [{ tennacy: 'multi' }, 'Auth config contains unsupported field "tennacy"'],
      [{ bootstrap: { mode: 'secret', secrett: 'typo' } },
        'Bootstrap config contains unsupported field "secrett"'],
      [{ registration: { mode: 'publci' } },
        'Unsupported registration mode: "publci"'],
      [{ registration: 'public' }, 'Registration config must be an object'],
      [{ account: { requireEmailVerificaiton: true } },
        'Account config contains unsupported field "requireEmailVerificaiton"'],
      [{ mfa: { allowUserChioce: true } },
        'MFA config contains unsupported field "allowUserChioce"'],
      [{ mfa: { totp: { encryptionKye: 'secret' } } },
        'MFA TOTP config contains unsupported field "encryptionKye"'],
      [{ accountEmails: { passwordRest: false } },
        'Account email config contains unsupported field "passwordRest"'],
      [{ requestAdmission: { trustedProxyRanges: '127.0.0.1' } },
        'trustedProxyRanges must be an array of strings'],
      [{ requestAdmission: { forwardedForHeader: true } },
        'forwardedForHeader must be a string'],
      [{ branding: { appNmae: 'Zero' } },
        'Auth branding config contains unsupported field "appNmae"'],
      [{ userProperties: { theme: { editableBY: 'admin' } } },
        'User property "theme" contains unsupported field "editableBY"'],
      [{ userProperties: null }, 'User properties config must be an object'],
      [{ strictUserProperties: 'true' },
        'strictUserProperties must be a boolean'],
      [{ account: { requireEmailVerification: 'true' } },
        'requireEmailVerification must be a boolean'],
      [{ mfa: { enabled: 'true' } }, 'MFA config enabled must be a boolean'],
      [{ accountEmails: { passwordReset: 'false' } },
        'Account email config passwordReset must be a boolean'],
    ];

    for (const [input, message] of invalid) {
      expect(() => resolveAuthBehaviorConfig(
        input as AuthBehaviorConfig,
      )).toThrow(message);
    }
  });

  test('accepts compact and object forms for the supported compatibility profile', () => {
    const compact = defineAuthConfig({
      tenancy: 'single',
      authorization: 'simple',
    });
    const compactTenancy: 'single' = compact.tenancy;
    const compactAuthorization: 'simple' = compact.authorization;

    const object = defineAuthConfig({
      tenancy: { mode: 'single' },
      authorization: { mode: 'simple' },
    });
    const objectTenancy: 'single' = object.tenancy.mode;
    const objectAuthorization: 'simple' = object.authorization.mode;

    expect(resolveAuthBehaviorConfig(compact)).toMatchObject({
      tenancy: { mode: compactTenancy },
      authorization: { mode: compactAuthorization },
    });
    expect(resolveAuthBehaviorConfig(object)).toMatchObject({
      tenancy: { mode: objectTenancy },
      authorization: { mode: objectAuthorization },
    });
  });

  test('preserves helper identity and established normalization reference boundaries', () => {
    const values = ['clinical', 'operations'];
    const template: AuthEmailTemplate = (context) => ({
      subject: context.defaultSubject,
      text: context.defaultText,
    });
    const input = defineAuthConfig({
      tenancy: 'multi',
      authorization: 'advanced',
      branding: { appName: 'Zero' },
      emails: { emailOtp: template },
      userProperties: {
        department: { type: 'enum', values },
      },
    });

    expect(defineAuthConfig(input)).toBe(input);

    const resolved = resolveAuthBehaviorConfig(input);
    expect(Object.isFrozen(resolved)).toBe(false);
    expect(Object.isFrozen(resolved.tenancy)).toBe(true);
    expect(Object.isFrozen(resolved.tenancy.terminology)).toBe(true);
    expect(Object.isFrozen(resolved.tenancy.creation)).toBe(true);
    expect(Object.isFrozen(resolved.authorization)).toBe(true);
    expect(Object.isFrozen(resolved.authorization.permissions)).toBe(true);
    expect(Object.isFrozen(resolved.authorization.roles)).toBe(true);
    expect(Object.isFrozen(resolved.authorization.roles.member)).toBe(true);
    expect(Object.isFrozen(resolved.authorization.roles.member?.permissions)).toBe(true);
    expect(Object.isFrozen(resolved.branding)).toBe(false);
    expect(Object.isFrozen(resolved.emails)).toBe(false);
    expect(Object.isFrozen(resolved.userProperties)).toBe(false);
    expect(resolved.branding).not.toBe(input.branding);
    expect(resolved.emails.emailOtp).toBe(template);
    expect(resolved.userProperties.department?.values).toBe(values);
  });

  test('preserves validation precedence across configuration concerns', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'invalid' as never,
      authorization: 'invalid' as never,
      bootstrap: 'invalid' as never,
    })).toThrow('Unsupported tenancy mode: "invalid"');

    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: 'invalid' as never,
      bootstrap: 'invalid' as never,
    })).toThrow('Unsupported authorization mode: "invalid"');

    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: true,
            allowedRequestRoles: ['missing'],
            defaultRequestRole: 'missing',
          },
        },
      },
      bootstrap: 'invalid' as never,
    })).toThrow('Verified-domain request role is not declared: "missing"');

    expect(() => resolveAuthBehaviorConfig({
      bootstrap: 'invalid' as never,
      registration: { mode: 'invalid' as never },
    })).toThrow('Unsupported bootstrap mode: "invalid"');
  });

  test('normalizes all four tenancy/authorization profiles deterministically', () => {
    const profiles: Array<[
      AuthBehaviorConfig,
      AuthTenancyMode,
      AuthAuthorizationMode,
    ]> = [
      [{ tenancy: 'single', authorization: 'simple' }, 'single', 'simple'],
      [{ tenancy: 'single', authorization: 'advanced' }, 'single', 'advanced'],
      [{ tenancy: 'multi', authorization: 'simple' }, 'multi', 'simple'],
      [{ tenancy: 'multi', authorization: 'advanced' }, 'multi', 'advanced'],
    ];

    for (const [input, tenancy, authorization] of profiles) {
      const resolved = resolveAuthBehaviorConfig(input);
      expect(resolved.tenancy.mode).toBe(tenancy);
      expect(resolved.authorization.mode).toBe(authorization);
      if (tenancy === 'single' && authorization === 'simple') {
        expect(resolved.authorization).toEqual({
          mode: 'simple',
          registryVersion: 1,
          permissions: {},
          roles: {},
        });
      } else if (tenancy === 'single') {
        expect(Object.keys(resolved.authorization.permissions)).toEqual([
          'application.roles:manage',
          'application.roles:read',
        ]);
        expect(Object.keys(resolved.authorization.roles)).toEqual([
          'access-manager',
          'owner',
        ]);
        expect(resolved.authorization.permissions['application.users:manage'])
          .toBeUndefined();
        expect(resolved.authorization.permissions['application.tenants:manage'])
          .toBeUndefined();
      } else {
        expect(Object.keys(resolved.authorization.permissions)).toContain('tenant:read');
        expect(Object.keys(resolved.authorization.permissions)).toContain('tenant.roles:manage');
        expect(resolved.authorization.permissions['application.users:manage']?.scope)
          .toBe('application');
        expect(resolved.authorization.permissions['application.audit:read']?.scope)
          .toBe('application');
        expect(resolved.authorization.roles.administrator?.permissions)
          .toEqual(expect.arrayContaining([
            'application.audit:read',
            'application.audit:manage',
          ]));
        expect(resolved.authorization.roles['access-manager']?.permissions)
          .not.toContain('application.audit:read');
        expect(Object.keys(resolved.authorization.roles)).toEqual([
          'access-manager',
          'administrator',
          'manager',
          'member',
          'owner',
        ]);
      }
    }
  });

  test('normalizes and validates an explicit authorization registry version', () => {
    expect(resolveAuthBehaviorConfig({
      authorization: { mode: 'advanced', registryVersion: 7 },
    }).authorization.registryVersion).toBe(7);
    for (const registryVersion of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() => resolveAuthBehaviorConfig({
        authorization: { mode: 'advanced', registryVersion },
      })).toThrow('Authorization registryVersion must be an integer between 1');
    }
  });

  test('keeps verified-domain release owner-only in the packaged tenant roles', () => {
    const resolved = resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: 'simple',
    });
    expect(Object.hasOwn(
      resolved.authorization.permissions,
      'tenant.domains:release',
    )).toBe(true);
    expect(resolved.authorization.roles.manager?.permissions)
      .toContain('tenant.domains:verify');
    expect(resolved.authorization.roles.manager?.permissions)
      .not.toContain('tenant.domains:release');
    expect(resolved.authorization.roles.owner).toMatchObject({
      allPermissions: true,
      system: true,
    });
  });

  test('normalizes immutable multi-tenant terminology and creation policy', () => {
    const defaults = resolveAuthBehaviorConfig({ tenancy: 'multi' });
    expect(defaults.tenancy).toEqual({
      mode: 'multi',
      terminology: { singular: 'organization', plural: 'organizations' },
      creation: { mode: 'authenticated' },
      onboarding: {
        invitations: {
          enabled: true,
          defaultTTLms: 7 * 24 * 60 * 60 * 1_000,
          maxTTLms: 30 * 24 * 60 * 60 * 1_000,
          accountCreation: true,
          delivery: {
            default: 'manual',
            allowManual: true,
            email: {
              enabled: false,
              landingPath: '/accept-invitation',
              previousEncryptionKeys: [],
            },
          },
        },
        joinRequests: { enabled: true },
        verifiedDomains: {
          enabled: false,
          admission: 'request-to-join',
          allowedRequestRoles: ['member'],
          defaultRequestRole: 'member',
          challengeTTLms: 24 * 60 * 60 * 1_000,
          dnsCheckCooldownMs: 30 * 1_000,
          reverifyIntervalMs: 7 * 24 * 60 * 60 * 1_000,
          gracePeriodMs: 3 * 24 * 60 * 60 * 1_000,
          reverifyRetryIntervalMs: 60 * 60 * 1_000,
          mailboxProofMaxAgeMs: 30 * 60 * 1_000,
          mailboxLinkTTLms: 30 * 60 * 1_000,
          admissionTTLms: 10 * 60 * 1_000,
          deniedRetryCooldownMs: 7 * 24 * 60 * 60 * 1_000,
          mailboxLandingPath: '/domain-onboarding',
          sharedMailboxDomains: [],
          dnsTimeoutMs: 5 * 1_000,
          maxTxtAnswers: 32,
          maxTxtBytes: 8_192,
          maxClaimsPerTenant: 20,
        },
      },
    });
    expect(Object.isFrozen(defaults.tenancy)).toBe(true);
    expect(Object.isFrozen(defaults.tenancy.terminology)).toBe(true);
    expect(Object.isFrozen(defaults.tenancy.creation)).toBe(true);
    expect(Object.isFrozen(defaults.tenancy.onboarding)).toBe(true);

    expect(resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        terminology: { singular: ' Practice ', plural: ' Practices ' },
        creation: { mode: 'platform-admin' },
      },
    }).tenancy).toEqual({
      mode: 'multi',
      terminology: { singular: 'practice', plural: 'practices' },
      creation: { mode: 'platform-admin' },
      onboarding: {
        invitations: {
          enabled: true,
          defaultTTLms: 7 * 24 * 60 * 60 * 1_000,
          maxTTLms: 30 * 24 * 60 * 60 * 1_000,
          accountCreation: true,
          delivery: {
            default: 'manual',
            allowManual: true,
            email: {
              enabled: false,
              landingPath: '/accept-invitation',
              previousEncryptionKeys: [],
            },
          },
        },
        joinRequests: { enabled: true },
        verifiedDomains: {
          enabled: false,
          admission: 'request-to-join',
          allowedRequestRoles: ['member'],
          defaultRequestRole: 'member',
          challengeTTLms: 24 * 60 * 60 * 1_000,
          dnsCheckCooldownMs: 30 * 1_000,
          reverifyIntervalMs: 7 * 24 * 60 * 60 * 1_000,
          gracePeriodMs: 3 * 24 * 60 * 60 * 1_000,
          reverifyRetryIntervalMs: 60 * 60 * 1_000,
          mailboxProofMaxAgeMs: 30 * 60 * 1_000,
          mailboxLinkTTLms: 30 * 60 * 1_000,
          admissionTTLms: 10 * 60 * 1_000,
          deniedRetryCooldownMs: 7 * 24 * 60 * 60 * 1_000,
          mailboxLandingPath: '/domain-onboarding',
          sharedMailboxDomains: [],
          dnsTimeoutMs: 5 * 1_000,
          maxTxtAnswers: 32,
          maxTxtBytes: 8_192,
          maxClaimsPerTenant: 20,
        },
      },
    });

    const localized = resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        terminology: { singular: 'practice', plural: 'practices' },
      },
    });
    expect(localized.authorization.permissions['tenant:read']).toMatchObject({
      label: 'View practice',
      description: 'View the active practice and its safe settings.',
    });
    expect(localized.authorization.permissions['tenant.domains:read']).toMatchObject({
      label: 'View practice domains',
      description: 'View safe domain-claim state for the active practice.',
    });
    expect(localized.authorization.roles.member).toMatchObject({
      description: 'Standard practice membership.',
    });
    expect(localized.authorization.roles.owner).toMatchObject({
      description: 'Protected practice owner with every declared permission.',
    });
  });

  test('rejects tenant-only config in single mode and validates every nested field', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: { mode: 'single', creation: { mode: 'disabled' } },
    })).toThrow('require tenancy mode "multi"');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: { mode: 'multi', typo: true } as never,
    })).toThrow('contains unsupported field "typo"');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: { mode: 'multi', terminology: { singluar: 'team' } as never },
    })).toThrow('contains unsupported field "singluar"');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: { mode: 'multi', terminology: { singular: '   ' } },
    })).toThrow('singular must be a non-empty string');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: { mode: 'multi', creation: { mode: 'anyone' as never } },
    })).toThrow('Unsupported tenant creation mode: "anyone"');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: { delivery: { email: { enabled: true } } },
        },
      },
    })).toThrow('requires an operator-managed encryptionKey');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: {
            delivery: {
              email: { enabled: true, encryptionKey: 'low entropy passphrase' },
            },
          },
        },
      },
    })).toThrow('base64url-encoded 32-byte key');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          invitations: {
            delivery: {
              email: {
                enabled: true,
                encryptionKey: Buffer.alloc(32).toString('base64url'),
              },
            },
          },
        },
      },
    })).toThrow('repeated or placeholder');
  });

  test('validates verified-domain request roles against the active authorization profile', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: true,
            allowedRequestRoles: ['missing'],
            defaultRequestRole: 'missing',
          },
        },
      },
    })).toThrow('request role is not declared');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          joinRequests: { enabled: false },
          verifiedDomains: { enabled: true },
        },
      },
    })).toThrow('requires joinRequests.enabled');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: true,
            allowedRequestRoles: ['unbounded'],
            defaultRequestRole: 'unbounded',
          },
        },
      },
      authorization: {
        mode: 'advanced',
        roles: { unbounded: { allPermissions: true } },
      },
    })).toThrow('must be non-system and bounded');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: true,
            allowedRequestRoles: ['automation'],
            defaultRequestRole: 'automation',
          },
        },
      },
      authorization: {
        mode: 'advanced',
        roles: { automation: { system: true, permissions: [] } },
      },
    })).toThrow('must be non-system and bounded');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: { enabled: true, dnsTimeout: '61s' },
        },
      },
    })).toThrow('verifiedDomains.dnsTimeout');

    const simple = resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: true,
            allowedRequestRoles: ['manager'],
            defaultRequestRole: 'manager',
          },
        },
      },
      authorization: 'simple',
    });
    expect(simple.tenancy.onboarding?.verifiedDomains).toMatchObject({
      enabled: true,
      allowedRequestRoles: ['manager'],
      defaultRequestRole: 'manager',
      maxClaimsPerTenant: 20,
    });
  });

  test('rejects non-organization verified-domain roles while onboarding is disabled', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: false,
            allowedRequestRoles: ['administrator'],
            defaultRequestRole: 'administrator',
          },
        },
      },
      authorization: 'advanced',
    })).toThrow('must be assignable to organization tenants: "administrator"');

    expect(() => resolveAuthBehaviorConfig({
      tenancy: {
        mode: 'multi',
        onboarding: {
          verifiedDomains: {
            enabled: false,
            allowedRequestRoles: ['application-auditor'],
            defaultRequestRole: 'application-auditor',
          },
        },
      },
      authorization: {
        mode: 'advanced',
        permissions: {
          'application.reports:read': { scope: 'application' },
        },
        roles: {
          'application-auditor': {
            permissions: ['application.reports:read'],
          },
        },
      },
    })).toThrow('must be assignable to organization tenants: "application-auditor"');
  });

  test('normalizes a validated permission registry and static role templates', () => {
    const first = resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        permissions: {
          'staff:manage': { label: ' Manage staff ' },
          'patients:read': { description: ' Read patient records ' },
        },
        roles: {
          owner: { allPermissions: true, system: true },
          clinician: {
            label: ' Clinician ',
            permissions: ['staff:manage', 'patients:read'],
          },
        },
      },
    });
    const second = resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        permissions: {
          'patients:read': { description: 'Read patient records' },
          'staff:manage': { label: 'Manage staff' },
        },
        roles: {
          clinician: {
            permissions: ['patients:read', 'staff:manage'],
            label: 'Clinician',
          },
          owner: { system: true, allPermissions: true },
        },
      },
    });

    expect(first.authorization).toEqual(second.authorization);
    expect(Object.keys(first.authorization.permissions)).toEqual([
      'application.roles:manage',
      'application.roles:read',
      'patients:read',
      'staff:manage',
    ]);
    expect(first.authorization.roles.clinician).toEqual({
      key: 'clinician',
      label: 'Clinician',
      permissions: ['patients:read', 'staff:manage'],
      allPermissions: false,
      system: false,
    });
    expect(first.authorization.roles.owner).toMatchObject({
      allPermissions: true,
      permissions: [],
      system: true,
    });
  });

  test('protects framework registry keys and normalizes exact owner adoption', () => {
    const tenantPermissions = resolveAuthBehaviorConfig({ tenancy: 'multi' })
      .authorization.permissions;
    expect(tenantPermissions['workflows:manage']).toMatchObject({
      key: 'workflows:manage',
      label: 'Manage workflows',
    });
    expect(tenantPermissions['notifications:manage']).toMatchObject({
      key: 'notifications:manage',
      label: 'Manage notifications',
    });
    expect(tenantPermissions['rooms:manage']).toMatchObject({
      key: 'rooms:manage',
      label: 'Manage rooms',
    });
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        permissions: {
          'workflows:manage': { label: 'Unsafe override' },
        },
      },
    })).toThrow('framework-owned and cannot be redefined');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        permissions: {
          'notifications:manage': { label: 'Unsafe notification override' },
        },
      },
    })).toThrow('framework-owned and cannot be redefined');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        permissions: {
          'rooms:manage': { label: 'Unsafe room override' },
        },
      },
    })).toThrow('framework-owned and cannot be redefined');
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        permissions: {
          'application.roles:read': { label: 'App override' },
        },
      },
    })).toThrow('framework-owned and cannot be redefined');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        roles: { owner: { allPermissions: false } },
      },
    })).toThrow('framework-owned');

    expect(resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        ownerAdoption: { email: ' Owner@Example.COM ' },
      },
    }).authorization.ownerAdoption).toEqual({ email: 'owner@example.com' });
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        mode: 'advanced',
        ownerAdoption: { userId: 'usr_1', email: 'owner@example.com' },
      },
    })).toThrow('requires exactly one');
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        mode: 'simple',
        ownerAdoption: { userId: 'usr_1' },
      },
    })).toThrow('requires single/advanced mode');

    expect(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        legacySimpleRoleAdoption: true,
      },
    }).authorization.legacySimpleRoleAdoption).toBe(true);
    for (const profile of [
      { tenancy: 'single', authorization: 'simple' },
      { tenancy: 'single', authorization: 'advanced' },
      { tenancy: 'multi', authorization: 'simple' },
    ] as const) {
      expect(() => resolveAuthBehaviorConfig({
        tenancy: profile.tenancy,
        authorization: {
          mode: profile.authorization,
          legacySimpleRoleAdoption: true,
        },
      })).toThrow('requires multi/advanced mode');
    }
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        legacySimpleRoleAdoption: false as never,
      },
    })).toThrow('must be true when configured');
  });

  test('rejects invalid permissions and role templates before runtime startup', () => {
    expect(() => resolveAuthBehaviorConfig({
      authorization: { permissions: { read: {} } },
    })).toThrow('Invalid permission key "read"');
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        permissions: { 'patients:read': {} },
        roles: { clinician: { permissions: ['patients:write'] } },
      },
    })).toThrow('references undeclared permission "patients:write"');
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        permissions: { 'patients:read': {} },
        roles: { clinician: { permissions: ['patients:read', 'patients:read'] } },
      },
    })).toThrow('repeats permission "patients:read"');
    expect(() => resolveAuthBehaviorConfig({
      authorization: {
        permissions: { 'patients:read': {} },
        roles: {
          owner: { allPermissions: true, permissions: ['patients:read'] },
        },
      },
    })).toThrow('cannot combine allPermissions with explicit permissions');
    expect(() => resolveAuthBehaviorConfig({
      authorization: { permissions: { 'patients:read': { lable: 'typo' } as never } },
    })).toThrow('contains unsupported field "lable"');
  });

  test('rejects unknown capability mode values separately from recognized future modes', () => {
    expect(() => resolveAuthBehaviorConfig({
      tenancy: 'shared' as never,
    })).toThrow('Unsupported tenancy mode: "shared"');
    expect(() => resolveAuthBehaviorConfig({
      authorization: { mode: 'permissions' as never },
    })).toThrow('Unsupported authorization mode: "permissions"');
    expect(() => resolveAuthBehaviorConfig({
      tenancy: true as never,
    })).toThrow('Tenancy config must be a mode string or an object with a mode');
    expect(() => resolveAuthBehaviorConfig({
      authorization: [] as never,
    })).toThrow('Authorization config must be a mode string or an object with a mode');
  });

  test('exposes required normalized capability modes in the resolved contract', () => {
    const resolved = resolveAuthBehaviorConfig({});
    const tenancy: AuthTenancyMode = resolved.tenancy.mode;
    const authorization: AuthAuthorizationMode = resolved.authorization.mode;

    expect([tenancy, authorization]).toEqual(['single', 'simple']);
  });

  test('keeps legacy resolved-config test doubles source-compatible', () => {
    const { tenancy: _tenancy, authorization: _authorization, ...legacy } =
      resolveAuthBehaviorConfig({});
    const compatible: ResolvedAuthBehaviorConfig = legacy;

    expect(compatible.registration.mode).toBe('public');
  });

  test('normalizes account email verification defaults and paths', () => {
    const defaults = resolveAuthBehaviorConfig();
    expect(defaults.account.requireEmailVerification).toBe(false);
    expect(defaults.account.emailVerificationPath).toBe('/verify-email');
    expect(defaults.account.allowAdminMarkEmailVerified).toBe(false);

    const configured = resolveAuthBehaviorConfig({
      account: {
        requireEmailVerification: true,
        emailVerificationPath: 'auth/verify',
        allowAdminMarkEmailVerified: true,
      },
    });
    expect(configured.account.requireEmailVerification).toBe(true);
    expect(configured.account.emailVerificationPath).toBe('/auth/verify');
    expect(configured.account.allowAdminMarkEmailVerified).toBe(true);
  });

  test('does not advertise unimplemented password-change notices', () => {
    const configured = resolveAuthBehaviorConfig({
      accountEmails: { passwordChangedNotice: true },
    });

    expect(configured.accountEmails.passwordChangedNotice).toBe(false);
  });

  test('normalizes MFA defaults and configured self-hosted TOTP settings', () => {
    const defaults = resolveAuthBehaviorConfig();
    expect(defaults.mfa.enabled).toBe(false);
    expect(defaults.mfa.policy).toBe('optional');
    expect(defaults.mfa.methods).toEqual(['email', 'totp']);
    expect(defaults.mfa.allowUserChoice).toBe(true);
    expect(defaults.mfa.allowMultipleMethods).toBe(false);
    expect(defaults.mfa.recoveryCodes).toBe(false);
    expect(defaults.mfa.totp.qrRobustness).toBe('M');

    const configured = resolveAuthBehaviorConfig({
      mfa: {
        enabled: true,
        policy: 'required',
        methods: ['totp', 'email', 'totp'],
        allowUserChoice: true,
        allowMultipleMethods: false,
        challengeTTL: '15m',
        challengeCooldown: '2m',
        maxAttempts: 3,
        recoveryCodes: false,
        totp: {
          issuer: 'Zero CRM',
          encryptionKey: 'secret',
          qrRobustness: 'Q',
        },
      },
    });

    expect(configured.mfa.enabled).toBe(true);
    expect(configured.mfa.policy).toBe('required');
    expect(configured.mfa.methods).toEqual(['totp', 'email']);
    expect(configured.mfa.challengeTTL).toBe('15m');
    expect(configured.mfa.challengeCooldown).toBe('2m');
    expect(configured.mfa.maxAttempts).toBe(3);
    expect(configured.mfa.recoveryCodes).toBe(false);
    expect(configured.mfa.totp).toEqual({
      issuer: 'Zero CRM',
      encryptionKey: 'secret',
      qrRobustness: 'Q',
    });
  });

  test('rejects unsupported MFA policy, methods, and limits', () => {
    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { policy: 'bad-policy' as never },
      })
    ).toThrow('Unsupported MFA policy');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { methods: ['sms' as never] },
      })
    ).toThrow('Unsupported MFA method');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { methods: [] },
      })
    ).toThrow('MFA methods must include');

    expect(() =>
      resolveAuthBehaviorConfig({
        mfa: { maxAttempts: 0 },
      })
    ).toThrow('MFA maxAttempts');
  });

  test('defaults user properties to self-editable and not policy trusted', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        theme: {
          type: 'enum',
          values: ['light', 'dark'],
        },
      },
    });

    expect(config.userProperties.theme).toMatchObject({
      editableBy: 'user',
      useInPolicies: false,
    });
    expect(isPolicyTrustedUserProperty(config.userProperties.theme)).toBe(false);
  });

  test('allows admin, system, and none-editable properties to opt into policy use', () => {
    const config = resolveAuthBehaviorConfig({
      userProperties: {
        department: {
          type: 'enum',
          values: ['accounting', 'support'],
          editableBy: 'admin',
          useInPolicies: true,
        },
        clearance: {
          type: 'string',
          editableBy: 'system',
          useInPolicies: true,
        },
        complianceHold: {
          type: 'boolean',
          editableBy: 'none',
          useInPolicies: true,
        },
      },
    });

    expect(isPolicyTrustedUserProperty(config.userProperties.department)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.clearance)).toBe(true);
    expect(isPolicyTrustedUserProperty(config.userProperties.complianceHold)).toBe(true);
  });

  test('rejects policy trust for self-editable user properties', () => {
    expect(() =>
      resolveAuthBehaviorConfig({
        userProperties: {
          notificationsEnabled: {
            type: 'boolean',
            editableBy: 'user',
            useInPolicies: true,
          },
        },
      })
    ).toThrow('cannot set useInPolicies: true');
  });
});
