/** Pure feature admission and additive profile defaults, before Guardian policy bootstrap. */
import type {
  AuthBehaviorConfig,
  NormalizedAuthBehaviorConfig,
} from '../auth/types';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import {
  assertOnlyKeys,
  assertPlainRecord,
  assertOptionalBoolean,
} from '../auth/auth-config-validation';
import type { BlogConfig, ResolvedBlogConfig } from './types';
export function blogEnabled(input: boolean | BlogConfig | undefined): boolean {
  if (input !== undefined && typeof input !== 'boolean')
    assertPlainRecord(input, 'Blog config');
  return input !== false && input !== undefined;
}
export function withBlogProfileDefaults<T extends AuthBehaviorConfig>(
  auth: T,
  input: boolean | BlogConfig | undefined,
): T {
  if (!blogEnabled(input)) return auth;
  const profile = auth.userProfile ?? {};
  if (profile.enabled === false)
    throw new Error(
      '[blog] Enable auth.userProfile to use managed authors. Other authentication settings are unchanged.',
    );
  const avatar =
    typeof profile.avatars === 'boolean'
      ? { enabled: profile.avatars }
      : (profile.avatars ?? {});
  const requireAvatar =
    typeof input === 'object' ? (input.authors?.requireAvatar ?? true) : true;
  if (
    requireAvatar &&
    (avatar.enabled === false || avatar.publicAccess === false)
  )
    throw new Error(
      '[blog] Author photos require auth.userProfile.avatars.enabled and publicAccess. Explicit private policy is never overridden; alternatively opt out with blog.authors.requireAvatar:false.',
    );
  return {
    ...auth,
    userProfile: {
      ...profile,
      fields: {
        preferredName: true,
        bio: true,
        website: true,
        socialLinks: true,
        ...profile.fields,
      },
      avatars: { enabled: true, publicAccess: requireAvatar, ...avatar },
    },
  };
}
export function resolveBlogConfig(
  input: boolean | BlogConfig | undefined,
  auth: NormalizedAuthBehaviorConfig | null,
): ResolvedBlogConfig {
  if (
    input !== undefined &&
    typeof input !== 'boolean' &&
    (!input || typeof input !== 'object' || Array.isArray(input))
  )
    throw new Error('[blog] Expected false, true or a BlogConfig object.');
  const enabled = blogEnabled(input),
    config = typeof input === 'object' && input ? input : {};
  assertPlainRecord(config, 'Blog config');
  assertOnlyKeys(
    config,
    ['authors', 'manageAuthors', 'siteName'],
    'Blog config',
  );
  const authors = config.authors === undefined ? {} : config.authors;
  assertPlainRecord(authors, 'Blog authors');
  assertOnlyKeys(authors, ['requireAvatar', 'requireBio'], 'Blog authors');
  assertOptionalBoolean(authors.requireAvatar, 'Blog authors requireAvatar');
  assertOptionalBoolean(authors.requireBio, 'Blog authors requireBio');
  const siteName = config.siteName ?? 'Blog';
  if (typeof siteName !== 'string' || !siteName.trim() || siteName.length > 160)
    throw new Error('[blog] siteName must contain 1–160 characters.');
  if (enabled && !auth)
    throw new Error(
      '[blog] Guardian must be enabled. Explicit auth:false is never overridden.',
    );
  const manageAuthors = freezeRequirement(
    structuredClone(
      config.manageAuthors ??
        (auth?.tenancy.mode === 'multi'
          ? { permission: 'tenant.members:manage' }
          : 'admin'),
    ),
  );
  if (enabled) {
    const kernel = createAuthorizationKernel(auth!);
    const compiled = kernel.compile(manageAuthors, {
      user: 'required',
      credentials: ['session'],
    });
    if (
      !compiled.platformRoleGroups.length &&
      !compiled.scopeRoleGroups.length &&
      !compiled.allPermissions.length &&
      !compiled.anyPermissionGroups.length &&
      !compiled.propertyGroups.length
    )
      throw new Error(
        '[blog] manageAuthors must restrict management to a Guardian role, permission or trusted property.',
      );
  }
  return Object.freeze({
    enabled,
    requireAvatar: authors.requireAvatar ?? true,
    requireBio: authors.requireBio ?? false,
    manageAuthors,
    siteName: siteName.trim(),
  });
}
export function blogPolicyFingerprint(config: ResolvedBlogConfig): string {
  return new Bun.CryptoHasher('sha256')
    .update(JSON.stringify(config))
    .digest('hex');
}
function freezeRequirement<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) freezeRequirement(child, seen);
    Object.freeze(value);
  }
  return value;
}
