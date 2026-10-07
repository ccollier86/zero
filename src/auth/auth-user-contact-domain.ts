/** Shared contact policy, snapshot and final-writer admission. No delivery transport. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { AuthEmailOutbox } from './auth-email-outbox';
import { AuthUserContactStore, type ContactChallenge } from './auth-user-contact-store';
import { inspectUserContactSchema } from './auth-user-contact-schema';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { PhoneVerificationAdapter, ResolvedAuthUserContactConfig, UserContactCapabilities, UserContactSnapshot, UserContactValue } from './auth-user-contact-types';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext, type AuthContextAuthorityReference } from './types';
import type { UserStore } from './user-store';
import { isUserProfilePolicyReady } from './auth-user-profile-policy';

export interface UserContactDependencies {
  db: ReactiveDB; users: UserStore; tokens: TokenService; actions: AuthActionTokenService;
  email: AccountEmailService; config: ResolvedAuthUserContactConfig;
  getOutbox(): AuthEmailOutbox | null; adapter?: PhoneVerificationAdapter;
  emitCode: AuthPlatformCodeEmitter; clock?: () => number;
}
export class AuthUserContactDomain {
  readonly store: AuthUserContactStore;
  readonly now: () => number;
  disposed = false;
  constructor(readonly deps: UserContactDependencies) {
    this.store = new AuthUserContactStore(deps.db, deps.users, deps.emitCode);
    this.now = deps.clock ?? Date.now;
    if (deps.adapter && (!/^[A-Za-z0-9._-]{1,128}$/.test(deps.adapter.id)
      || typeof deps.adapter.isReady !== 'function' || typeof deps.adapter.start !== 'function'
      || typeof deps.adapter.verify !== 'function')) throw new Error('[auth] Phone verification adapter must have a bounded id and supported methods.');
  }
  assertReady(): void {
    if (this.disposed) throw new AuthError('Contact service is unavailable', 'AUTH_CONTACT_NOT_READY', 503);
    this.deps.users.assertCurrentProfile();
    this.deps.users.assertCurrentUserProfilePolicy();
    if (!this.deps.config.enabled) throw new AuthError('Contact settings are disabled', 'AUTH_CONTACT_DISABLED', 403);
    this.store.assertReady();
  }
  capabilities(auth?: AuthContext): UserContactCapabilities {
    if (!this.disposed) this.deps.users.assertCurrentProfile();
    const config = this.deps.config;
    const state = !config.enabled ? 'disabled'
      : !this.disposed && inspectUserContactSchema(this.deps.db) === 'ready'
        && isUserProfilePolicyReady(this.deps.users) ? 'ready' : 'blocked';
    const emailReadable = !auth || auth.sessionKind !== 'native' || Boolean(auth.scope?.includes('email'));
    const phoneReadable = !auth || auth.sessionKind !== 'native' || Boolean(auth.scope?.includes('phone'));
    const writable = !auth || auth.sessionKind !== 'native' || Boolean(auth.scope?.includes('contacts:write'));
    const emailReady = state === 'ready' && this.emailReady();
    return { state, verificationPath: config.verificationPath,
      email: { readable: emailReadable, verifyReady: emailReadable && writable && config.email.verify && emailReady,
        changeReady: emailReadable && writable && config.email.change && emailReady,
        cancelReady: state === 'ready' && emailReadable && writable },
      phone: { readable: phoneReadable, enabled: state === 'ready' && config.phone.enabled,
        editable: state === 'ready' && phoneReadable && writable && config.phone.enabled && config.phone.editable,
        verifyReady: state === 'ready' && phoneReadable && writable && config.phone.enabled && config.phone.verify && this.phoneReady(),
        cancelReady: state === 'ready' && phoneReadable && writable && config.phone.enabled } };
  }
  emailReady(): boolean {
    try { this.deps.email.assertReady(); return true; } catch { return false; }
  }
  phoneReady(): boolean {
    const adapter = this.deps.adapter;
    if (!adapter) return false;
    try {
      return invokeSynchronousAuthCallback(() => adapter.isReady(), { component: 'user-contacts',
        invariant: 'phone-adapter-readiness-async', message: '[auth] Phone adapter readiness must be synchronous.',
        emitCode: this.deps.emitCode }) === true;
    } catch { return false; }
  }
  capture(auth: AuthContext, channel?: 'email' | 'phone', write = false): { reference: AuthContextAuthorityReference; current(): AuthContext } {
    this.assertReady();
    if (auth.credentialKind === 'api-key' || (auth.sessionKind !== 'web' && auth.sessionKind !== 'native')) {
      throw new AuthError('A signed-in account session is required', 'AUTH_CONTACT_SESSION_REQUIRED', 403);
    }
    const scopes = (current: AuthContext) => {
      if (current.sessionKind === 'native' && (!current.scope?.includes('profile')
        || (channel && !current.scope.includes(channel)) || (write && !current.scope.includes('contacts:write')))) {
        throw new AuthError('This session does not grant the requested contact access', 'AUTH_CONTACT_SCOPE_REQUIRED', 403);
      }
    };
    scopes(auth);
    const reference = this.deps.tokens.captureAuthContextAuthority(auth);
    if (!reference) throw contactAuthorityChanged();
    return { reference, current: () => {
      this.assertReady();
      const current = this.deps.tokens.resolveAuthContextAuthority(reference);
      if (!current) throw contactAuthorityChanged();
      scopes(current); return current;
    } };
  }
  currentChallenge(row: ContactChallenge): AuthContext {
    this.assertReady();
    const current = this.deps.tokens.resolveAuthContextAuthority(this.store.authority(row));
    const config = this.deps.config;
    const enabled = row.kind === 'email_change' ? config.email.change : row.kind === 'email_verify' ? config.email.verify
      : config.phone.enabled && config.phone.verify;
    const user = this.deps.users.getUserById(row.user_id);
    const contact = this.store.read(row.user_id);
    const generation = row.kind === 'phone_verify' ? contact.phone_generation : this.deps.users.getEmailGeneration(row.user_id);
    if (!current || !enabled || !user || user.status !== 'active' || row.expires_at <= this.now()
      || (row.status !== 'pending' && row.status !== 'delivered') || row.contact_generation !== generation
      || (row.kind === 'phone_verify' && (row.contact_value !== contact.phone || row.adapter_id !== this.deps.adapter?.id))
      || (row.kind === 'email_verify' && row.contact_value !== user.email)) throw invalidContactChallenge();
    this.capture(current, row.kind === 'phone_verify' ? 'phone' : 'email', true).current();
    return current;
  }
  createChallenge(auth: AuthContext, kind: ContactChallenge['kind'], value: string, expected: number): ContactChallenge {
    const channel = kind === 'phone_verify' ? 'phone' : 'email';
    const admission = this.capture(auth, channel, true);
    admission.current();
    const previous = this.store.latest(auth.userId, channel);
    if (previous && previous.created_at + this.deps.config.resendCooldownMs > this.now()) {
      throw new AuthError('Contact verification is cooling down; try again shortly', 'AUTH_CONTACT_COOLDOWN', 429);
    }
    const row = this.store.advance(auth.userId, expected, this.now());
    const challenge: ContactChallenge = { challenge_id: `acc_${crypto.randomUUID()}`, user_id: auth.userId,
      kind, contact_value: value, contact_generation: channel === 'phone' ? row.phone_generation : this.deps.users.getEmailGeneration(auth.userId),
      auth_generation: admission.reference.authGeneration, authority_json: JSON.stringify(admission.reference),
      adapter_id: channel === 'phone' ? this.deps.adapter!.id : null, adapter_reference: null,
      outbox_job_id: channel === 'email' ? `aem_${crypto.randomUUID()}` : null,
      status: 'pending', attempts: 0, delivery_attempts: 0, lease_owner: null, lease_expires_at: null,
      expires_at: this.now() + this.deps.config.challengeTTLms, created_at: this.now(), updated_at: this.now() };
    this.store.create(challenge);
    admission.current();
    return challenge;
  }
  snapshot(auth: AuthContext): UserContactSnapshot {
    this.assertReady();
    const contact = this.store.read(auth.userId);
    const user = this.deps.users.getUserById(auth.userId)!;
    const emailGeneration = this.deps.users.getEmailGeneration(auth.userId);
    const caps = this.capabilities(auth);
    const emailChallenge = this.store.pending(auth.userId, 'email', this.now());
    const phoneChallenge = this.store.pending(auth.userId, 'phone', this.now());
    const value = (channel: 'email' | 'phone'): UserContactValue => {
      const phone = channel === 'phone';
      const current = phone ? contact.phone : user.email;
      const generation = phone ? contact.phone_generation : emailGeneration;
      const proved = phone ? contact.phone_proof_generation : contact.email_proof_generation;
      const provedAt = phone ? contact.phone_proved_at : contact.email_proved_at;
      const attested = !phone && contact.email_attested_generation === generation;
      const challenge = phone ? phoneChallenge : emailChallenge;
      const delivery = phone ? this.phoneReady() : this.emailReady();
      return { value: current, state: current === null ? 'absent' : proved === generation ? 'possession-verified'
        : challenge ? delivery ? 'pending' : 'delivery-unavailable' : attested ? 'administratively-attested' : 'unverified',
        verifiedAt: proved === generation ? provedAt : attested ? contact.email_attested_at : null,
        pendingValue: challenge?.contact_value ?? null, challengeId: challenge?.challenge_id ?? null,
        expiresAt: challenge?.expires_at ?? null };
    };
    return { userId: auth.userId, revision: contact.revision,
      email: caps.email.readable ? value('email') : null,
      phone: caps.phone.readable && this.deps.config.phone.enabled ? value('phone') : null,
      capabilities: caps };
  }
}
export function contactAuthorityChanged(): AuthError {
  return new AuthError('Authorization changed before the contact operation could complete', 'AUTHORIZATION_CHANGED', 409);
}
export function invalidContactChallenge(): AuthError {
  return new AuthError('Contact verification challenge is invalid or no longer available', 'AUTH_CONTACT_CHALLENGE_INVALID', 400);
}
export function contactUnavailable(): AuthError {
  return new AuthError('Contact verification delivery is unavailable', 'AUTH_CONTACT_DELIVERY_UNAVAILABLE', 503);
}
