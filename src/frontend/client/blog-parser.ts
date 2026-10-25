/** Response admission is distinct from draft validation and never fabricates missing public identity. */
import type {
  BlogAuthorRecord,
  BlogAuthorPage,
  BlogCapabilities,
  BlogPublicAuthor,
} from '../../blog/types';
import { captureBlogProfile } from '../../blog/validation';
import { isUserPublicAvatarAsset } from './auth-user-avatar-parser';
const object = (input: unknown): input is Record<string, any> =>
  !!input && typeof input === 'object' && !Array.isArray(input);
const string = (input: unknown, max: number): input is string =>
  typeof input === 'string' && input.length <= max;
const id = (input: unknown, prefix: string) =>
  typeof input === 'string' &&
  new RegExp('^' + prefix + '_[a-f0-9-]{36}$').test(input);
const revision = (input: unknown) =>
  Number.isSafeInteger(input) &&
  Number(input) > 0 &&
  Number(input) < Number.MAX_SAFE_INTEGER;
export function assertBlogAuthor(
  input: unknown,
): asserts input is BlogAuthorRecord {
  if (
    !object(input) ||
    !id(input.id, 'bau') ||
    !id(input.siteId, 'bls') ||
    (input.userId !== null && !string(input.userId, 256)) ||
    !['active', 'suspended', 'revoked'].includes(input.status) ||
    !revision(input.revision) ||
    typeof input.published !== 'boolean' ||
    !Number.isSafeInteger(input.updatedAt) ||
    input.updatedAt < 0 ||
    !object(input.readiness) ||
    typeof input.readiness.ready !== 'boolean' ||
    !Array.isArray(input.readiness.missing) ||
    input.readiness.missing.length > 3 ||
    new Set(input.readiness.missing).size !== input.readiness.missing.length ||
    input.readiness.missing.some(
      (key: unknown) =>
        !['displayName', 'avatar', 'bio'].includes(key as string),
    ) ||
    input.readiness.ready !== (input.readiness.missing.length === 0)
  )
    throw invalid();
  try {
    if (
      Object.keys(
        captureBlogProfile({
          expectedRevision: input.revision,
          changes: input.profile,
        }).changes,
      ).length !== 7
    )
      throw invalid();
  } catch {
    throw invalid();
  }
}
export function assertBlogPage(
  input: unknown,
): asserts input is BlogAuthorPage {
  if (
    !object(input) ||
    !Array.isArray(input.items) ||
    input.items.length > 100 ||
    (input.nextCursor !== null && !id(input.nextCursor, 'bau'))
  )
    throw invalid();
  for (const row of input.items) assertBlogAuthor(row);
}
export function assertBlogCapabilities(
  input: unknown,
): asserts input is BlogCapabilities {
  if (
    !object(input) ||
    !['ready', 'blocked', 'disabled'].includes(input.state) ||
    typeof input.canManageAuthors !== 'boolean' ||
    typeof input.canEditProfile !== 'boolean' ||
    !object(input.requirements) ||
    input.requirements.name !== true ||
    typeof input.requirements.avatar !== 'boolean' ||
    typeof input.requirements.bio !== 'boolean' ||
    (input.state !== 'ready' &&
      (input.canManageAuthors || input.canEditProfile))
  )
    throw invalid();
  if (
    input.site !== null &&
    (!object(input.site) ||
      !id(input.site.id, 'bls') ||
      !string(input.site.slug, 100) ||
      !string(input.site.name, 160) ||
      !revision(input.site.revision))
  )
    throw invalid();
  if (input.self !== null) {
    assertBlogAuthor(input.self);
    if (input.self.siteId !== input.site?.id) throw invalid();
  }
}
export function assertBlogPublicAuthor(
  input: unknown,
): asserts input is BlogPublicAuthor {
  if (
    !object(input) ||
    !id(input.id, 'bau') ||
    !id(input.siteId, 'bls') ||
    !string(input.name, 120) ||
    !input.name.trim() ||
    !string(input.slug, 100) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
    Object.keys(input).some(
      (key) =>
        ![
          'id',
          'siteId',
          'name',
          'slug',
          'byline',
          'bio',
          'website',
          'socialLinks',
          'avatar',
        ].includes(key),
    )
  )
    throw invalid();
  try {
    captureBlogProfile({
      expectedRevision: 1,
      changes: {
        displayName: input.name,
        slug: input.slug,
        byline: input.byline ?? null,
        bio: input.bio ?? null,
        website: input.website ?? null,
        socialLinks: input.socialLinks,
        avatar: null,
      },
    });
  } catch {
    throw invalid();
  }
  if (input.avatar !== undefined && !isUserPublicAvatarAsset(input.avatar))
    throw invalid();
}
function invalid() {
  return new Error('The blog response was invalid. Reload before continuing.');
}
