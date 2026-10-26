import { expect, test } from 'bun:test';
import {
  resolveConfig as resolveAppConfig,
  type AppConfig,
} from '../frontend/server/types';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { normalizeAuthUserAvatar } from '../auth/auth-config-user-avatar';
import { resolveBlogConfig, withBlogProfileDefaults } from './config';
const resolveConfig = (input: Omit<AppConfig, 'db'>) =>
  resolveAppConfig({ db: { mode: 'memory' }, ...input });

test('blog is inert by default and enables author profile defaults without changing identity, roles or login requirements', () => {
  const defaults = resolveConfig({ tables: {} });
  expect(defaults.blog.enabled).toBe(false);
  expect(defaults.auth).toBe(false);
  const existing = {
    tenancy: 'single' as const,
    userProfile: {
      fields: { bio: { enabled: true, editable: false }, username: false },
    },
  };
  const copy = structuredClone(existing),
    supplemented = withBlogProfileDefaults(existing, true);
  expect(existing).toEqual(copy);
  expect(supplemented.userProfile?.fields?.bio).toEqual({
    enabled: true,
    editable: false,
  });
  const config = resolveConfig({ tables: {}, blog: true, auth: existing });
  expect(config.auth).not.toBe(false);
  const profile = resolveAuthBehaviorConfig(config.auth || {}).userProfile;
  expect(profile.fields.socialLinks.enabled).toBe(true);
  expect(profile.avatars.publicAccess).toBe(true);
  expect(profile.completion.enabled).toBe(false);
  expect(profile.completion.existingUsers).toBe('none');
  expect(resolveConfig({ tables: {}, blog: true }).auth).not.toBe(false);
});
test('explicit disabled privacy/auth policy is not overwritten and requirement changes are opt-in', () => {
  expect(() =>
    resolveConfig({ tables: {}, auth: false, blog: true }),
  ).toThrow();
  expect(() =>
    resolveConfig({
      tables: {},
      auth: { userProfile: { enabled: false } },
      blog: true,
    }),
  ).toThrow();
  expect(() =>
    resolveConfig({
      tables: {},
      auth: {
        userProfile: { avatars: { enabled: true, publicAccess: false } },
      },
      blog: true,
    }),
  ).toThrow();
  const optional = resolveConfig({
    tables: {},
    auth: { userProfile: { avatars: false } },
    blog: { authors: { requireAvatar: false } },
  });
  expect(optional.blog.requireAvatar).toBe(false);
  expect(normalizeAuthUserAvatar(true).publicAccess).toBe(false);
  expect(() =>
    normalizeAuthUserAvatar({ enabled: true, publicAccess: 'yes' } as never),
  ).toThrow();
});
test('management always needs a Guardian authority condition and unknown blog options fail admission', () => {
  const auth = resolveAuthBehaviorConfig();
  for (const input of [
    { manageAuthors: false },
    { manageAuthors: true },
    { manageAuthors: 'required' },
    { fields: {} },
    { authors: { typo: true } },
  ]) {
    expect(() => resolveBlogConfig(input as never, auth)).toThrow();
  }
  const multi = resolveBlogConfig(
    true,
    resolveAuthBehaviorConfig({ tenancy: 'multi' }),
  );
  expect(multi.scope).toBe('application');
  expect(multi.manageAuthors).toBe('admin');
  expect(resolveBlogConfig({ scope: 'organization' }, resolveAuthBehaviorConfig({ tenancy: 'multi' })).manageAuthors).toEqual({ permission: 'tenant.members:manage' });
  const requirement = { platformRole: ['admin'] },
    copy = resolveBlogConfig({ manageAuthors: requirement }, auth);
  requirement.platformRole.push('user');
  expect(copy.manageAuthors).toEqual({ platformRole: ['admin'] });
  expect(Object.isFrozen(copy.manageAuthors)).toBe(true);
  for (const invalid of [
    null,
    0,
    '',
    [],
    { authors: null },
    { authors: { requireAvatar: 'yes' } },
  ]) {
    expect(() =>
      resolveConfig({ tables: {}, blog: invalid as never }),
    ).toThrow();
  }
});
