/** Managed blog configuration and Guardian-backed author/profile contracts. */
import type { AccessRequirement } from '../auth/authorization-kernel';
import type { UserPublicAvatarAsset } from '../auth/auth-user-avatar-types';
import type { BlogContentConfig } from './content-config';
import type { BlogPostsApi, BlogTaxonomiesApi } from './content-types';
import type { BlogMediaApi } from './media-types';
import type { BlogMetricsApi } from './metrics-types';
export interface BlogConfig {
  /** One application-owned public blog by default, independent of customer tenancy. */
  scope?: 'application' | 'organization';
  /** Managed private Fabric content plane; false retains author/profile-only composition. */
  content?: boolean | BlogContentConfig;
  /** Public presentation address; does not overwrite an existing application route. */
  basePath?: string;
  /** Install the Magazine and sidebar-TOC reader at basePath. false enables headless/custom page composition. */
  pages?: boolean;
  authors?: { requireAvatar?: boolean; requireBio?: boolean };
  /** Existing Guardian requirement; no role template or current assignment is rewritten. */
  manageAuthors?: AccessRequirement;
  posts?: { manage?: AccessRequirement; publish?: AccessRequirement };
  /** Name for a newly created scoped author directory. */
  siteName?: string;
}
export interface ResolvedBlogConfig {
  readonly enabled: boolean;
  readonly requireAvatar: boolean;
  readonly requireBio: boolean;
  readonly manageAuthors: AccessRequirement;
  readonly managePosts: AccessRequirement;
  readonly publishPosts: AccessRequirement | null;
  readonly siteName: string;
  readonly scope: 'application' | 'organization';
  readonly content: boolean | BlogContentConfig;
  readonly basePath: string;
  readonly pages: boolean;
}
export type BlogAuthorStatus = 'active' | 'suspended' | 'revoked';
export interface BlogAuthorProfile {
  displayName: string;
  slug: string;
  byline: string | null;
  bio: string | null;
  website: string | null;
  socialLinks: readonly { label: string; url: string }[];
  /** Explicitly use the account's published avatar, or omit a photo. */
  avatar: 'account' | null;
}
export interface BlogAuthorReadiness {
  ready: boolean;
  missing: readonly ('displayName' | 'avatar' | 'bio')[];
}
export interface BlogAuthorRecord {
  id: string;
  siteId: string;
  userId: string | null;
  status: BlogAuthorStatus;
  revision: number;
  profile: BlogAuthorProfile;
  published: boolean;
  readiness: BlogAuthorReadiness;
  updatedAt: number;
}
export interface BlogPublicAuthor {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  byline?: string;
  bio?: string;
  website?: string;
  socialLinks: readonly { label: string; url: string }[];
  avatar?: UserPublicAvatarAsset;
}
export interface BlogSite {
  id: string;
  name: string;
  slug: string;
  revision: number;
}
export interface BlogCapabilities {
  state: 'ready' | 'blocked' | 'disabled';
  canManageAuthors: boolean;
  canEditProfile: boolean;
  requirements: { name: true; avatar: boolean; bio: boolean };
  site: BlogSite | null;
  self: BlogAuthorRecord | null;
}
export interface BlogAuthorPage {
  items: readonly BlogAuthorRecord[];
  nextCursor: string | null;
}
export interface AssignBlogAuthorInput {
  userId: string;
  expectedRevision: number;
  status?: BlogAuthorStatus;
}
export interface UpdateBlogAuthorProfileInput {
  expectedRevision: number;
  changes: Partial<BlogAuthorProfile>;
}
export interface ScopedBlogAuthors {
  capabilities(): BlogCapabilities;
  authors: {
    list(options?: { limit?: number; after?: string }): BlogAuthorPage;
    get(userId: string): BlogAuthorRecord;
    assign(input: AssignBlogAuthorInput): BlogAuthorRecord;
    updateProfile(
      userId: string,
      input: UpdateBlogAuthorProfileInput,
    ): BlogAuthorRecord;
    publishProfile(userId: string, expectedRevision: number): BlogAuthorRecord;
    withdrawProfile(userId: string, expectedRevision: number): BlogAuthorRecord;
  };
}
/** The request facade has a stable shape even when content publishing is disabled. */
export interface ScopedBlog extends ScopedBlogAuthors {
  posts: BlogPostsApi;
  taxonomies: BlogTaxonomiesApi;
  media: BlogMediaApi;
  metrics: BlogMetricsApi;
}
