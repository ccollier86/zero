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
    ['authors', 'manageAuthors', 'siteName', 'scope', 'content', 'basePath', 'pages', 'posts'],
    'Blog config',
  );
  const authors = config.authors === undefined ? {} : config.authors;
  assertPlainRecord(authors, 'Blog authors');
  assertOnlyKeys(authors, ['requireAvatar', 'requireBio'], 'Blog authors');
  assertOptionalBoolean(authors.requireAvatar, 'Blog authors requireAvatar');
  assertOptionalBoolean(authors.requireBio, 'Blog authors requireBio');
  const siteName = config.siteName ?? 'Blog';
  const scope = config.scope ?? 'application';
  if (scope !== 'application' && scope !== 'organization' || scope === 'organization' && auth?.tenancy.mode !== 'multi') throw new Error('[blog] Organization ownership requires multi tenancy.');
  const basePath = config.basePath ?? '/blog';
  if (typeof basePath !== 'string' || basePath.length > 200 || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath)) throw new Error('[blog] basePath must be a local path without query, traversal or fragment.');
  if (config.content !== undefined && typeof config.content !== 'boolean') assertPlainRecord(config.content, 'Blog content');
  assertOptionalBoolean(config.pages, 'Blog pages');
  const pages = enabled && config.content !== false && (config.pages ?? scope === 'application');
  if (config.pages === true && (config.content === false || scope !== 'application')) throw new Error('[blog] Managed public pages require application-owned content. Use pages:false and the public facade for custom organization routes.');
  if (typeof siteName !== 'string' || !siteName.trim() || siteName.length > 160)
    throw new Error('[blog] siteName must contain 1–160 characters.');
  if (enabled && !auth)
    throw new Error(
      '[blog] Guardian must be enabled. Explicit auth:false is never overridden.',
    );
  const manageAuthors = freezeRequirement(
    structuredClone(
      config.manageAuthors ??
        (scope === 'organization'
          ? { permission: 'tenant.members:manage' }
          : 'admin'),
    ),
  );
  const posts = config.posts ?? {};
  assertPlainRecord(posts, 'Blog post permissions'); assertOnlyKeys(posts, ['manage', 'publish'], 'Blog post permissions');
  const managePosts = freezeRequirement(structuredClone(posts.manage ?? manageAuthors));
  const publishPosts = posts.publish === undefined ? null : freezeRequirement(structuredClone(posts.publish));
  if (enabled) {
    const kernel = createAuthorizationKernel(auth!);
    if (scope === 'application' && auth!.tenancy.mode === 'multi') {
      for (const requirement of [manageAuthors, managePosts, ...(publishPosts === null ? [] : [publishPosts])]) {
        const compiled = kernel.compile(requirement);
        const permissions = [...compiled.allPermissions, ...compiled.anyPermissionGroups.flat()];
        if (compiled.tenant || compiled.scopeRoleGroups.length || permissions.some(key => kernel.authorization.permissions[key]?.scope !== 'application')) {
          throw new Error('[blog] Application-owned blog permissions must use platform roles, application permissions or trusted properties, not customer-organization authority.');
        }
      }
    }
    for (const requirement of [managePosts, ...(publishPosts === null ? [] : [publishPosts])]) {
      const compiled = kernel.compile(requirement, { user: 'required', credentials: ['session'] });
      if (!compiled.platformRoleGroups.length && !compiled.scopeRoleGroups.length && !compiled.allPermissions.length && !compiled.anyPermissionGroups.length && !compiled.propertyGroups.length) throw new Error('[blog] Post management/publication overrides must declare an actual Guardian restriction.');
    }
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
    managePosts,
    publishPosts,
    siteName: siteName.trim(),
    scope,
    content: config.content ?? true,
    basePath,
    pages,
  });
}
export function blogPolicyFingerprint(config: ResolvedBlogConfig): string {
  return new Bun.CryptoHasher('sha256')
    .update(JSON.stringify({ enabled: config.enabled, requireAvatar: config.requireAvatar, requireBio: config.requireBio, manageAuthors: config.manageAuthors, managePosts: config.managePosts, publishPosts: config.publishPosts, siteName: config.siteName, scope: config.scope, basePath: config.basePath }))
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
