/** Closed canonical author commands. No arbitrary markup, storage URL or authority fields. */
import { AuthError } from '../auth/types';
import type {
  BlogAuthorProfile,
  UpdateBlogAuthorProfileInput,
  AssignBlogAuthorInput,
} from './types';
export function blogInvalid(): never {
  throw new AuthError(
    'The blog request is invalid.',
    'BLOG_INVALID_INPUT',
    422,
  );
}
export function blogRecord(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || !keys.includes(key),
    )
  )
    return blogInvalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(input)) {
    const property = Object.getOwnPropertyDescriptor(input, key)!;
    if (!('value' in property)) return blogInvalid();
    result[key] = property.value;
  }
  return result;
}
export function blogRevision(value: unknown, allowZero = false): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < (allowZero ? 0 : 1) ||
    Number(value) >= Number.MAX_SAFE_INTEGER
  )
    return blogInvalid();
  return Number(value);
}
export function blogUserId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 256 ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    return blogInvalid();
  return value;
}
export function blogText(
  value: unknown,
  max: number,
  nullable = false,
): string | null {
  if (value === null && nullable) return null;
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)
  )
    return blogInvalid();
  return value.trim();
}
export function blogUrl(value: unknown): string | null {
  if (value === null || value === '') return null;
  const text = blogText(value, 2048)!;
  try {
    const url = new URL(text);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return blogInvalid();
    return url.href;
  } catch {
    return blogInvalid();
  }
}
export function captureBlogAssignment(input: unknown): AssignBlogAuthorInput {
  const body = blogRecord(input, ['userId', 'expectedRevision', 'status']),
    status = body.status ?? 'active';
  if (
    !['active', 'suspended', 'revoked'].includes(status as string) ||
    typeof status !== 'string'
  )
    return blogInvalid();
  return {
    userId: blogUserId(body.userId),
    expectedRevision: blogRevision(body.expectedRevision, true),
    status: status as AssignBlogAuthorInput['status'],
  };
}
export function captureBlogProfile(
  input: unknown,
): UpdateBlogAuthorProfileInput {
  const body = blogRecord(input, ['expectedRevision', 'changes']),
    changes = blogRecord(body.changes, [
      'displayName',
      'slug',
      'byline',
      'bio',
      'website',
      'socialLinks',
      'avatar',
    ]);
  if (!Object.keys(changes).length) return blogInvalid();
  const accepted: Partial<BlogAuthorProfile> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'displayName') accepted.displayName = blogText(value, 120)!;
    if (key === 'byline') accepted.byline = blogText(value, 160, true);
    if (key === 'bio') accepted.bio = blogText(value, 2000, true);
    if (key === 'website') accepted.website = blogUrl(value);
    if (key === 'slug') {
      if (
        typeof value !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) ||
        value.length > 100
      )
        return blogInvalid();
      accepted.slug = value;
    }
    if (key === 'avatar') {
      if (value !== 'account' && value !== null) return blogInvalid();
      accepted.avatar = value;
    }
    if (key === 'socialLinks') {
      if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > 12 ||
        Reflect.ownKeys(value).length !== value.length + 1
      )
        return blogInvalid();
      const links: Array<{ label: string; url: string }> = [];
      for (let i = 0; i < value.length; i++) {
        const property = Object.getOwnPropertyDescriptor(value, String(i));
        if (!property || !('value' in property)) return blogInvalid();
        const record = blogRecord(property.value, ['label', 'url']),
          label = blogText(record.label, 80),
          url = blogUrl(record.url);
        if (!label || !url) return blogInvalid();
        links.push({ label, url });
      }
      accepted.socialLinks = links;
    }
  }
  return {
    expectedRevision: blogRevision(body.expectedRevision),
    changes: accepted,
  };
}
