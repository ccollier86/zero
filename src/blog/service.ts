/** Scoped author enrollment and public-byline publication, bound to existing Guardian authority. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from '../auth/user-store';
import type { TenancyService } from '../auth/tenancy/tenancy-service';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { applicationServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import {
  authAuditActorFromContext,
  type AuthAuditService,
} from '../auth/auth-audit-service';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import type { UserPublicAvatarAsset } from '../auth/auth-user-avatar-types';
import { inspectBlogSchema, reconcileBlogSchema } from './schema';
import { blogPolicyFingerprint } from './config';
import {
  blogRevision,
  blogText,
  blogUserId,
  captureBlogAssignment,
  captureBlogProfile,
  blogInvalid,
} from './validation';
import type {
  BlogAuthorProfile,
  BlogAuthorRecord,
  BlogPublicAuthor,
  BlogSite,
  BlogCapabilities,
  ResolvedBlogConfig,
  ScopedBlog,
} from './types';
import type { BlogContentService } from './content-service';
import { unavailableBlogContent } from './content-unavailable';

export const ZERO_BLOG = createZeroRuntimeServiceKey<BlogService>(
  'Managed blog authors',
);
interface SiteRow {
  site_id: string;
  scope_key: string;
  slug: string;
  name: string;
  revision: number;
}
interface AuthorRow {
  author_id: string;
  site_id: string;
  user_id: string | null;
  status: BlogAuthorRecord['status'];
  revision: number;
  slug: string;
  draft_json: string;
  published_slug: string | null;
  published_json: string | null;
  updated_at: number;
}
export interface BlogAuthority {
  access: RequestAuthorizationAccess;
  scope: ServiceDataScope;
  assertCurrentAuthoritySync(): void;
}
export interface BlogDependencies {
  db: ReactiveDB;
  users: UserStore;
  tenancy?: TenancyService | null;
  config: ResolvedBlogConfig;
  installAllowed: boolean;
  publicAvatar(userId: string): UserPublicAvatarAsset | null;
  audit?: AuthAuditService;
  now?: () => number;
  onAccepted?: (operation: string, targetId: string) => void;
}
export class BlogService {
  private generation: number | null = null;
  private stopped = false;
  private readonly fingerprint: string;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private readonly now: () => number;
  private content: BlogContentService | null = null;
  constructor(private readonly deps: BlogDependencies) {
    if (deps.db.getTransactionDomain() !== deps.users.getTransactionDomain())
      throw new AuthError(
        'Blog metadata requires the SYSTEM transaction domain',
        'BLOG_STATE_INVALID',
        500,
      );
    this.now = deps.now ?? Date.now;
    this.fingerprint = blogPolicyFingerprint(deps.config);
  }
  initialize(): void {
    const { db, users, config } = this.deps;
    if (config.enabled) reconcileBlogSchema(db, this.deps.installAllowed);
    if (inspectBlogSchema(db) !== 'ready') return;
    installAuthAuthorityRevision(db);
    users.transaction(() => {
      users.assertCurrentProfile();
      const old = db
        .prepare(
          'SELECT fingerprint,generation FROM _blog_policy WHERE singleton=1',
        )
        .get() as { fingerprint: string; generation: number } | null;
      if (
        old &&
        (!Number.isSafeInteger(old.generation) ||
          old.generation < 1 ||
          old.generation >= Number.MAX_SAFE_INTEGER - 1 ||
          !/^[a-f0-9]{64}$/.test(old.fingerprint))
      )
        throw invalidState();
      const generation = old
        ? old.generation + (old.fingerprint === this.fingerprint ? 0 : 1)
        : 1;
      db.prepare(
        'INSERT INTO _blog_policy(singleton,fingerprint,generation) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET fingerprint=excluded.fingerprint,generation=excluded.generation',
      ).run(this.fingerprint, generation);
      this.generation = generation;
      if (config.enabled && config.scope === 'application') this.ensureSite(applicationServiceDataScope());
    });
    if (config.enabled) this.unsubscribe = db.onChange(() => this.notify());
  }
  /** @internal Managed startup publishes content only after its isolated Fabric owner is ready. */
  attachContent(content: BlogContentService): void { if (this.content) throw invalidState(); this.content = content; }
  /** @internal Explicit application ownership is independent of the session's selected customer organization. */
  get ownership() { return this.deps.config.scope; }
  /** @internal Used by native HTTP mutation controllers to wait outside SQLite, never around async content/provider work. */
  get transactionDomain() { return this.deps.db; }
  close(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.notify();
    this.listeners.clear();
  }
  get isClosed(): boolean {
    return this.stopped;
  }
  subscribe(listener: () => void): () => void {
    if (this.stopped)
      throw new AuthError('Blog services have stopped.', 'BLOG_NOT_READY', 503);
    if (this.listeners.size >= 128)
      throw new AuthError(
        'Blog live connection limit reached',
        'BLOG_CAPACITY',
        429,
      );
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  forAuthority(authority: BlogAuthority): ScopedBlog {
    const { access } = authority, scope = this.deps.config.scope === 'application' ? applicationServiceDataScope() : authority.scope,
      actor = access.requireUser();
    if (actor.credentialKind === 'api-key') throw forbidden();
    const admit = (write = false) => {
      invokeSynchronousAuthCallback(authority.assertCurrentAuthoritySync, {
        component: 'blog',
        invariant: 'live-authority',
        message: 'Blog authority must be synchronous',
      });
      const current = access.requireUser();
      if (
        current.userId !== actor.userId ||
        current.credentialKind === 'api-key' ||
        (current.sessionKind === 'native' &&
          (!current.scope?.includes('profile') ||
            (write && !current.scope.includes('profile:write'))))
      )
        throw forbidden();
      this.assertReady();
    };
    const manage = (write: boolean) => {
      admit(write);
      access.authorize(this.deps.config.manageAuthors);
    };
    const canManage = () => {
      try {
        admit(true);
        access.authorize(this.deps.config.manageAuthors);
        return true;
      } catch (error) {
        if (error instanceof AuthError && error.status < 500) return false;
        throw error;
      }
    };
    const site = () => this.site(scope);
    const getRow = (userId: string) => {
      const target = site();
      const row = target ? this.author(target.site_id, userId) : null;
      if (!row) throw notFound();
      return row;
    };
    const edit = (userId: string) => {
      admit(true);
      blogUserId(userId);
      if (userId !== actor.userId) manage(true);
      const row = getRow(userId);
      if (row.status !== 'active' || !this.eligible(scope, userId))
        throw forbidden();
      return row;
    };
    const commit = <T>(action: () => T) =>
      this.deps.users.transaction(() => {
        admit(true);
        const result = action();
        admit(true);
        return result;
      });
    const authorFacade: Pick<ScopedBlog, 'capabilities' | 'authors'> = Object.freeze({
      capabilities: (): BlogCapabilities => {
        try {
          admit();
        } catch (error) {
          if (
            error instanceof AuthError &&
            ['BLOG_NOT_READY', 'BLOG_DISABLED', 'BLOG_POLICY_CHANGED'].includes(
              error.code,
            )
          )
            return {
              state: this.deps.config.enabled ? 'blocked' : 'disabled',
              canManageAuthors: false,
              canEditProfile: false,
              requirements: this.requirements(),
              site: null,
              self: null,
            };
          throw error;
        }
        const directory = site(),
          self = directory
            ? this.author(directory.site_id, actor.userId)
            : null;
        return {
          state: 'ready',
          canManageAuthors: canManage(),
          canEditProfile:
            !!self &&
            self.status === 'active' &&
            this.eligible(scope, actor.userId) &&
            (actor.sessionKind !== 'native' ||
              !!actor.scope?.includes('profile:write')),
          requirements: this.requirements(),
          site: directory ? publicSite(directory) : null,
          self: self ? this.record(self) : null,
        };
      },
      authors: Object.freeze<ScopedBlog['authors']>({
        list: (options: { limit?: number; after?: string } = {}) => {
          manage(false);
          const limit = options.limit ?? 50,
            after = options.after ?? '';
          if (
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            typeof after !== 'string' ||
            (after && !/^bau_[a-f0-9-]{36}$/.test(after))
          )
            return blogInvalid();
          const directory = site();
          if (!directory) return { items: [], nextCursor: null };
          const rows = this.deps.db
            .prepare(
              'SELECT * FROM _blog_authors WHERE site_id=? AND author_id>? ORDER BY author_id LIMIT ?',
            )
            .all(directory.site_id, after, limit + 1) as AuthorRow[];
          const page = rows.slice(0, limit);
          admit();
          return {
            items: page.map((row) => this.record(row)),
            nextCursor: rows.length > limit ? page.at(-1)!.author_id : null,
          };
        },
        get: (userId: string) => {
          admit();
          blogUserId(userId);
          if (userId !== actor.userId) manage(false);
          const result = this.record(getRow(userId));
          admit();
          return result;
        },
        assign: (input) => {
          const value = captureBlogAssignment(input);
          manage(true);
          return commit(() => {
            manage(true);
            const currentSite = site(),
              previous = currentSite
                ? this.author(currentSite.site_id, value.userId)
                : null;
            if (
              !this.eligible(scope, value.userId) &&
              (!previous || value.status === 'active')
            )
              throw notFound();
            const directory = currentSite ?? this.ensureSite(scope);
            if ((previous?.revision ?? 0) !== value.expectedRevision)
              throw conflict();
            if (!previous) {
              const id = `bau_${crypto.randomUUID()}`,
                profile = emptyProfile(`author-${id.slice(-12)}`);
              this.deps.db
                .prepare(
                  'INSERT INTO _blog_authors(author_id,site_id,user_id,status,revision,slug,draft_json,updated_at) VALUES (?,?,?,?,1,?,?,?)',
                )
                .run(
                  id,
                  directory.site_id,
                  value.userId,
                  value.status!,
                  profile.slug,
                  JSON.stringify(profile),
                  this.now(),
                );
            } else
              this.deps.db
                .prepare(
                  'UPDATE _blog_authors SET status=?,revision=revision+1,updated_at=? WHERE author_id=?',
                )
                .run(value.status!, this.now(), previous.author_id);
            const result = this.record(
              this.author(directory.site_id, value.userId)!,
            );
            this.accepted('author-assigned', result.id, authority);
            return result;
          });
        },
        updateProfile: (userId, input) => {
          const command = captureBlogProfile(input);
          edit(userId);
          return commit(() => {
            const row = edit(userId);
            if (row.revision !== command.expectedRevision) throw conflict();
            const profile = { ...decode(row.draft_json), ...command.changes };
            const collision = this.deps.db
              .prepare(
                'SELECT author_id FROM _blog_authors WHERE site_id=? AND author_id<>? AND (slug=? OR published_slug=?)',
              )
              .get(row.site_id, row.author_id, profile.slug, profile.slug);
            if (collision)
              throw new AuthError(
                'That author address is already in use.',
                'BLOG_SLUG_CONFLICT',
                409,
              );
            this.deps.db
              .prepare(
                'UPDATE _blog_authors SET draft_json=?,slug=?,revision=revision+1,updated_at=? WHERE author_id=?',
              )
              .run(
                JSON.stringify(profile),
                profile.slug,
                this.now(),
                row.author_id,
              );
            const result = this.record(getRow(userId));
            this.accepted('author-profile-updated', row.author_id, authority);
            return result;
          });
        },
        publishProfile: (userId, expectedRevision) =>
          commit(() => {
            blogRevision(expectedRevision);
            const row = edit(userId);
            if (row.revision !== expectedRevision) throw conflict();
            const profile = decode(row.draft_json),
              ready = this.readiness(profile, row.user_id);
            if (!ready.ready)
              throw new AuthError(
                'Complete the required public name, photo and biography before publishing.',
                'BLOG_AUTHOR_INCOMPLETE',
                422,
              );
            if (
              this.deps.db
                .prepare(
                  'SELECT author_id FROM _blog_authors WHERE site_id=? AND author_id<>? AND (slug=? OR published_slug=?)',
                )
                .get(row.site_id, row.author_id, profile.slug, profile.slug)
            )
              throw new AuthError(
                'That author address is already in use.',
                'BLOG_SLUG_CONFLICT',
                409,
              );
            this.deps.db
              .prepare(
                'UPDATE _blog_authors SET published_json=draft_json,published_slug=slug,revision=revision+1,updated_at=? WHERE author_id=?',
              )
              .run(this.now(), row.author_id);
            const result = this.record(getRow(userId));
            this.accepted('author-profile-published', row.author_id, authority);
            return result;
          }),
        withdrawProfile: (userId, expectedRevision) =>
          commit(() => {
            blogRevision(expectedRevision);
            blogUserId(userId);
            const row = getRow(userId);
            // A manager can withdraw retained public data without reactivating
            // a suspended author or a suspended canonical account.
            if (
              userId !== actor.userId ||
              row.status !== 'active' ||
              !this.eligible(scope, userId)
            )
              manage(true);
            if (row.revision !== expectedRevision) throw conflict();
            this.deps.db
              .prepare(
                'UPDATE _blog_authors SET published_json=NULL,published_slug=NULL,revision=revision+1,updated_at=? WHERE author_id=?',
              )
              .run(this.now(), row.author_id);
            const result = this.record(getRow(userId));
            this.accepted('author-profile-withdrawn', row.author_id, authority);
            return result;
          }),
      }),
    });
    return Object.freeze({ ...authorFacade, ...(this.content ? this.content.forAuthority(authority, authorFacade) : unavailableBlogContent(this.deps.config.basePath)) });
  }
  /** Public controllers receive the managed publishing service, never a database selector. */
  get publishing(): BlogContentService {
    this.assertReady();
    if (!this.content) throw new AuthError('Blog content publishing is not enabled.', 'BLOG_CONTENT_DISABLED', 503);
    return this.content;
  }
  /** @internal Public selector resolves only an intentionally public site under the installed ownership policy. */
  publicSite(siteSlug: string): BlogSite {
    this.assertReady();
    const row = this.deps.db.prepare('SELECT * FROM _blog_sites WHERE slug=?').get(blogText(siteSlug, 100)) as SiteRow | null;
    if (!row || this.deps.config.scope === 'application' && row.scope_key !== 'application' || this.deps.config.scope === 'organization' && !row.scope_key.startsWith('tenant:')) throw notFound();
    if (row.scope_key.startsWith('tenant:') && this.deps.tenancy?.getTenant(row.scope_key.slice(7))?.status !== 'active') throw notFound();
    return { id: row.site_id, name: row.name, slug: row.slug, revision: row.revision };
  }
  /** @internal Resolve an enrolled author by opaque author identity; never select a private account by display data. */
  contentAuthor(authority: BlogAuthority, authorId: string, manage: boolean): { record: BlogAuthorRecord; publication: BlogPublicAuthor | null } {
    const capabilities = this.forAuthority(authority).capabilities(), site = capabilities.site;
    const row = site ? this.deps.db.prepare('SELECT * FROM _blog_authors WHERE author_id=? AND site_id=?').get(authorId, site.id) as AuthorRow | null : null;
    const scope = this.deps.config.scope === 'application' ? applicationServiceDataScope() : authority.scope;
    if (!row || !row.user_id || row.status !== 'active' || !this.eligible(scope, row.user_id) || !manage && row.user_id !== authority.access.requireUser().userId) throw forbidden();
    let publication = null;
    if (row.published_slug) try { publication = this.publicAuthor(site!.slug, row.published_slug); } catch (error) { if (!(error instanceof AuthError) || error.status !== 404) throw error; }
    return { record: this.record(row), publication };
  }
  publicAuthor(siteSlug: string, authorSlug: string): BlogPublicAuthor {
    this.assertReady();
    if (
      typeof siteSlug !== 'string' ||
      !/^[a-z0-9-]{1,100}$/.test(siteSlug) ||
      typeof authorSlug !== 'string' ||
      !/^[a-z0-9-]{1,100}$/.test(authorSlug)
    )
      throw notFound();
    const site = this.deps.db
      .prepare('SELECT * FROM _blog_sites WHERE slug=?')
      .get(siteSlug) as SiteRow | null;
    if (site) this.publicSite(siteSlug);
    const row = site
      ? (this.deps.db
          .prepare(
            "SELECT * FROM _blog_authors WHERE site_id=? AND published_slug=? AND status='active' AND published_json IS NOT NULL",
          )
          .get(site.site_id, authorSlug) as AuthorRow | null)
      : null;
    if (
      !site ||
      !row ||
      !row.user_id ||
      !this.eligibleKey(site.scope_key, row.user_id)
    )
      throw notFound();
    const profile = decode(row.published_json!),
      readiness = this.readiness(profile, row.user_id);
    if (!readiness.ready) throw notFound();
    const avatar =
      profile.avatar === 'account' ? this.avatar(row.user_id) : null;
    this.assertReady();
    return {
      id: row.author_id,
      siteId: row.site_id,
      name: profile.displayName,
      slug: profile.slug,
      ...(profile.byline ? { byline: profile.byline } : {}),
      ...(profile.bio ? { bio: profile.bio } : {}),
      ...(profile.website ? { website: profile.website } : {}),
      socialLinks: profile.socialLinks,
      ...(avatar ? { avatar } : {}),
    };
  }
  /** Resolve only the currently published byline; never fall back to private account profile data. */
  publicAuthorById(siteSlug: string, authorId: string): BlogPublicAuthor | null {
    const site = this.publicSite(siteSlug);
    const row = this.deps.db.prepare('SELECT published_slug FROM _blog_authors WHERE site_id=? AND author_id=?')
      .get(site.id, authorId) as { published_slug: string | null } | null;
    if (!row?.published_slug) return null;
    try { return this.publicAuthor(siteSlug, row.published_slug); }
    catch (error) { if (error instanceof AuthError && error.status === 404) return null; throw error; }
  }
  private site(scope: ServiceDataScope) {
    return this.deps.db
      .prepare('SELECT * FROM _blog_sites WHERE scope_key=?')
      .get(serviceDataScopeKey(scope)) as SiteRow | null;
  }
  private ensureSite(scope: ServiceDataScope): SiteRow {
    const existing = this.site(scope);
    if (existing) return existing;
    const id = `bls_${crypto.randomUUID()}`,
      slug =
        scope.scopeKind === 'application'
          ? 'blog'
          : `site-${crypto.randomUUID()}`;
    this.deps.db
      .prepare(
        'INSERT INTO _blog_sites(site_id,scope_key,slug,name) VALUES (?,?,?,?)',
      )
      .run(id, serviceDataScopeKey(scope), slug, this.deps.config.siteName);
    return this.site(scope)!;
  }
  private author(siteId: string, userId: string) {
    return this.deps.db
      .prepare('SELECT * FROM _blog_authors WHERE site_id=? AND user_id=?')
      .get(siteId, userId) as AuthorRow | null;
  }
  private eligible(scope: ServiceDataScope, userId: string) {
    return this.eligibleKey(serviceDataScopeKey(scope), userId);
  }
  private eligibleKey(key: string, userId: string) {
    if (this.deps.users.getUserById(userId)?.status !== 'active') return false;
    if (key === 'application') return this.deps.config.scope === 'application';
    const tenantId = key.startsWith('tenant:') ? key.slice(7) : '';
    return (
      !!tenantId &&
      !!this.deps.tenancy
        ?.listActiveTenantMembershipsForUser(userId)
        .some((item) => item.tenant.tenantId === tenantId)
    );
  }
  private record(row: AuthorRow): BlogAuthorRecord {
    const profile = decode(row.draft_json);
    return {
      id: row.author_id,
      siteId: row.site_id,
      userId: row.user_id,
      status: row.status,
      revision: row.revision,
      profile,
      published: row.published_json !== null,
      readiness: this.readiness(profile, row.user_id),
      updatedAt: row.updated_at,
    };
  }
  private readiness(profile: BlogAuthorProfile, userId?: string | null) {
    const missing: Array<'displayName' | 'avatar' | 'bio'> = [];
    if (!profile.displayName) missing.push('displayName');
    if (this.deps.config.requireBio && !profile.bio) missing.push('bio');
    if (
      this.deps.config.requireAvatar &&
      (profile.avatar !== 'account' || !userId || !this.avatar(userId))
    )
      missing.push('avatar');
    return { ready: !missing.length, missing };
  }
  private avatar(userId: string) {
    try {
      return this.deps.publicAvatar(userId);
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.status < 500 ||
          [
            'AUTH_AVATAR_NOT_READY',
            'AUTH_AVATAR_PUBLIC_NOT_READY',
            'AUTH_PROFILE_NOT_READY',
          ].includes(error.code))
      )
        return null;
      throw error;
    }
  }
  private requirements() {
    return {
      name: true as const,
      avatar: this.deps.config.requireAvatar,
      bio: this.deps.config.requireBio,
    };
  }
  private assertReady() {
    if (this.stopped)
      throw new AuthError('Blog services have stopped.', 'BLOG_NOT_READY', 503);
    if (!this.deps.config.enabled)
      throw new AuthError('Blog authors are disabled.', 'BLOG_DISABLED', 403);
    if (this.generation === null || inspectBlogSchema(this.deps.db) !== 'ready')
      throw new AuthError(
        'Blog authors need a SYSTEM migration.',
        'BLOG_NOT_READY',
        503,
      );
    this.deps.users.assertCurrentProfile();
    const row = this.deps.db
      .prepare(
        'SELECT fingerprint,generation FROM _blog_policy WHERE singleton=1',
      )
      .get() as { fingerprint: string; generation: number } | null;
    if (
      !row ||
      row.fingerprint !== this.fingerprint ||
      row.generation !== this.generation
    )
      throw new AuthError(
        'Blog policy changed. Use the current runtime.',
        'BLOG_POLICY_CHANGED',
        409,
      );
  }
  private accepted(operation: string, id: string, authority: BlogAuthority) {
    this.deps.audit?.append({
      action: 'blog.' + operation,
      outcome: 'succeeded',
      scope:
        this.deps.config.scope === 'organization' && authority.scope.scopeKind === 'tenant'
          ? { kind: 'tenant', tenantId: authority.scope.tenantId }
          : { kind: 'application' },
      actor: authAuditActorFromContext(authority.access.requireUser()),
      target: { type: 'blog.author', id },
    });
    this.deps.users.afterCommit(() => {
      try {
        this.deps.onAccepted?.(operation, id);
      } catch {
        /* Accepted write is not retried for an observer. */
      }
      this.notify();
    });
  }
  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Projection owns failure. */
      }
    }
  }
}
function emptyProfile(slug: string): BlogAuthorProfile {
  return {
    displayName: '',
    slug,
    byline: null,
    bio: null,
    website: null,
    socialLinks: [],
    avatar: null,
  };
}
function decode(json: string): BlogAuthorProfile {
  try {
    const raw = JSON.parse(json);
    const captured = captureBlogProfile({
      expectedRevision: 1,
      changes: raw,
    }).changes;
    if (Object.keys(captured).length !== 7) throw invalidState();
    return captured as BlogAuthorProfile;
  } catch {
    throw invalidState();
  }
}
function publicSite(row: SiteRow): BlogSite {
  return {
    id: row.site_id,
    slug: row.slug,
    name: row.name,
    revision: row.revision,
  };
}
function invalidState() {
  return new AuthError('Blog state is invalid.', 'BLOG_STATE_INVALID', 500);
}
function notFound() {
  return new AuthError(
    'The author was not found.',
    'BLOG_AUTHOR_NOT_FOUND',
    404,
  );
}
function conflict() {
  return new AuthError(
    'The author changed. Review the current version.',
    'BLOG_REVISION_CONFLICT',
    409,
  );
}
function forbidden() {
  return new AuthError(
    'A permitted current author or manager session is required.',
    'BLOG_FORBIDDEN',
    403,
  );
}
