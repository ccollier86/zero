/** Private SYSTEM profile persistence, sharing UserStore's writer transaction and core CAS. */

import type { ReactiveDB } from '../sync/reactive-db';
import { validateUserRegionalPreferences } from './auth-config-user-profile';
import { inspectUserProfileSchema } from './auth-user-profile-schema';
import { captureSocialLinks, captureUserProfileUpdate } from './auth-user-profile-validation';
import type { UpdateUserProfileInput, UserProfileValues, UserRegionalPreferences } from './auth-user-profile-types';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';

interface ProfileRow { preferred_name: string | null; bio: string | null; website: string | null; social_links_json: string }
interface RegionalRow { locale: string | null; time_zone: string | null; time_format: UserRegionalPreferences['timeFormat']; week_starts_on: UserRegionalPreferences['weekStartsOn'] }

export interface StoredUserProfile { readonly userId: string; readonly revision: number; readonly email: string; readonly values: UserProfileValues }

/** Own only row mechanics; credentials and field policy are supplied by the service. */
export class AuthUserProfileStore {
  constructor(private readonly db: ReactiveDB, private readonly users: UserStore,
    private readonly emitCode?: AuthPlatformCodeEmitter) {
    if (db.getTransactionDomain() !== users.getTransactionDomain()) {
      throw this.invariant('transaction-domain');
    }
  }

  /** Read one global user's typed profile, never a caller-selected tenant database. */
  read(userId: string): StoredUserProfile {
    this.users.assertCurrentProfile();
    this.assertReady();
    const user = this.users.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    const revision = this.db.prepare('SELECT profile_revision FROM users WHERE user_id = ?').get(userId) as { profile_revision: number };
    if (!Number.isSafeInteger(revision?.profile_revision) || revision.profile_revision < 1) throw this.invariant('stored-revision');
    const profile = this.db.prepare('SELECT preferred_name, bio, website, social_links_json FROM _auth_user_profiles WHERE user_id = ?').get(userId) as ProfileRow | null;
    const regional = this.db.prepare('SELECT locale, time_zone, time_format, week_starts_on FROM _auth_user_regional_preferences WHERE user_id = ?').get(userId) as RegionalRow | null;
    const region: UserRegionalPreferences = {
      locale: regional?.locale ?? null, timeZone: regional?.time_zone ?? null,
      timeFormat: regional?.time_format ?? null, weekStartsOn: regional?.week_starts_on ?? null,
    };
    let socialLinks: UserProfileValues['socialLinks'] = [];
    try {
      if (profile) {
        if (typeof profile.social_links_json !== 'string' || profile.social_links_json.length > 65_536) throw new Error('Invalid retained profile');
        socialLinks = captureSocialLinks(JSON.parse(profile.social_links_json));
        // Validate retained optional scalars without adopting/coercing a corrupt value.
        captureUserProfileUpdate({ expectedRevision: 1, changes: {
          preferredName: profile.preferred_name, bio: profile.bio, website: profile.website,
        } });
      }
      validateUserRegionalPreferences(region);
    } catch { throw this.invariant('stored-values'); }
    return {
      userId, revision: revision.profile_revision, email: user.email,
      values: {
        firstName: user.firstName, lastName: user.lastName, username: user.username,
        preferredName: profile?.preferred_name ?? null, bio: profile?.bio ?? null,
        website: profile?.website ?? null, socialLinks, regional: region,
      },
    };
  }

  /** Atomically CAS cosmetic core/extended/regional changes; authorization remains service-owned. */
  update(userId: string, command: UpdateUserProfileInput, assertCurrentAuthority: () => void): StoredUserProfile {
    const input = captureUserProfileUpdate(command);
    return this.users.transaction(() => {
      this.assertReady();
      this.admit(assertCurrentAuthority);
      const current = this.read(userId);
      if (current.revision !== input.expectedRevision) throw profileRevisionConflict();
      if (input.changes.username !== undefined) {
        const duplicate = this.users.getUserByUsername(input.changes.username);
        if (duplicate && duplicate.userId !== userId) throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
      }
      const values = { ...current.values, ...input.changes,
        regional: { ...current.values.regional, ...input.changes.regional } };
      const now = Date.now();
      const changed = this.db.update('users', userId, {
        profile_revision: current.revision + 1, updated_at: now,
        ...(input.changes.firstName !== undefined ? { first_name: input.changes.firstName } : {}),
        ...(input.changes.lastName !== undefined ? { last_name: input.changes.lastName } : {}),
        ...(input.changes.username !== undefined ? { username: input.changes.username } : {}),
      });
      if (!changed) throw this.invariant('core-write');
      this.db.prepare(`INSERT INTO _auth_user_profiles
        (user_id, preferred_name, bio, website, social_links_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET preferred_name=excluded.preferred_name,
          bio=excluded.bio, website=excluded.website, social_links_json=excluded.social_links_json,
          updated_at=excluded.updated_at`).run(userId, values.preferredName, values.bio,
            values.website, JSON.stringify(values.socialLinks), now);
      this.db.prepare(`INSERT INTO _auth_user_regional_preferences
        (user_id, locale, time_zone, time_format, week_starts_on, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET locale=excluded.locale, time_zone=excluded.time_zone,
          time_format=excluded.time_format, week_starts_on=excluded.week_starts_on,
          updated_at=excluded.updated_at`).run(userId, values.regional.locale,
            values.regional.timeZone, values.regional.timeFormat, values.regional.weekStartsOn, now);
      this.admit(assertCurrentAuthority);
      const accepted = this.read(userId);
      if (accepted.revision !== current.revision + 1
        || JSON.stringify(accepted.values) !== JSON.stringify(values)) throw this.invariant('write-postcondition');
      return accepted;
    });
  }

  private assertReady(): void {
    this.users.assertCurrentUserProfilePolicy();
    if (inspectUserProfileSchema(this.db) !== 'ready') {
      throw new AuthError('Profile storage is not ready; apply the required SYSTEM migration', 'AUTH_PROFILE_NOT_READY', 503);
    }
  }

  private admit(authority: () => void): void {
    invokeSynchronousAuthCallback(authority, {
      component: 'user-profile-store', invariant: 'authority-async',
      message: 'Profile authority admission must be synchronous',
      emitCode: this.emitCode,
    });
  }

  private invariant(invariant: string): AuthError {
    return createAuthStateInvariantError(this.emitCode, {
      component: 'user-profile-store', invariant, message: 'Profile persistence invariant failed',
    });
  }
}

export function profileRevisionConflict(): AuthError {
  return new AuthError('Your profile changed. Review the current values before saving.', 'AUTH_PROFILE_REVISION_CONFLICT', 409);
}
