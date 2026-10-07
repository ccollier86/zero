/** Actual profile organism/hooks over synthetic, scope-bound profile receipts; no account or server writes. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Client } from '../../frontend/client/sdk';
import type { AuthPublicConfig, AuthUser } from '../../frontend/client/auth-types';
import type { UserProfileCapabilities, UserProfileSnapshot, UpdateUserProfileInput } from '../../auth/auth-user-profile-types';
import type { UserContactSnapshot, UserContactCapabilities, EmailContactVerificationResult } from '../../auth/auth-user-contact-types';
import { normalizeAuthUserProfile } from '../../auth/auth-config-user-profile';
import { ClientProvider } from '../../frontend/client/client-context';
import { RouterProvider, useRouter } from '../../frontend/client/router-context';
import { getAuthConfigController } from '../../frontend/client/auth-config-controller';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { UserProfileSettings, type UserProfileSettingsProps } from './user-profile-settings';
import { ContactEmailVerification } from './contact-email-verification';
import type { UserAvatarCapabilities, UserAvatarSnapshot } from '../../auth/auth-user-avatar-types';
import { normalizeAuthUserAvatar } from '../../auth/auth-config-user-avatar';
import { EMPTY_GUARDIAN_PRESENCE, type GuardianPresenceClientSnapshot } from '../../frontend/client/guardian-presence-client';
import { AvatarEditor } from '../avatar-editor';

const listeners = new Set<() => void>(), observations: string[] = [];
const observationEvents: FrontendObservabilityEvent[] = [];
const avatarAcceptedCallbacks: { reject(cause: unknown): void }[] = [];
const data = new AuthorizationDataBoundaryController();
let scope = 'account-a', gets = 0, contactsEnabled = false;
let holdProfileRead = false;
let failContactRead = false;
const profileReads: { value: UserProfileSnapshot; resolve(value: UserProfileSnapshot): void }[] = [];
let avatarsEnabled = false;
let presenceState: GuardianPresenceClientSnapshot = EMPTY_GUARDIAN_PRESENCE;
const avatarCapabilities: UserAvatarCapabilities = { ...normalizeAuthUserAvatar(true), state: 'ready' };
let avatarSnapshot: UserAvatarSnapshot = { userId: 'account-a', revision: 1, asset: null, capabilities: avatarCapabilities };
const contactCapabilities: UserContactCapabilities = { state: 'ready', verificationPath: '/verify-contact',
  email: { readable: true, verifyReady: true, changeReady: true, cancelReady: true },
  phone: { enabled: true, readable: true, editable: true, verifyReady: true, cancelReady: true } };
let contactSnapshot: UserContactSnapshot = { userId: 'account-a', revision: 1, capabilities: contactCapabilities,
  email: { value: 'jane@example.test', state: 'unverified', verifiedAt: null, pendingValue: null, challengeId: null, expiresAt: null },
  phone: { value: null, state: 'absent', verifiedAt: null, pendingValue: null, challengeId: null, expiresAt: null } };
function capabilities(state: UserProfileCapabilities['state'] = 'ready'): UserProfileCapabilities {
  const { contacts: _contactConfiguration, avatars: _avatarConfiguration, completion: _completionConfiguration, ...normalized } = normalizeAuthUserProfile({ fields: {
    firstName: { enabled: true, required: true }, lastName: true, preferredName: true,
    bio: true, website: true, socialLinks: true,
  }, regional: { enabled: true, defaults: { locale: 'en-US', timeZone: 'UTC', timeFormat: '24h', weekStartsOn: 1 } } });
  return { ...normalized, state, regional: { ...normalized.regional, editable: true } };
}
let snapshot: UserProfileSnapshot = { userId: 'account-a', email: 'jane@example.test', revision: 1,
  capabilities: capabilities(), values: { firstName: 'Jane', lastName: 'Doe', username: 'jane@example.test',
    preferredName: null, bio: 'Saved biography', website: 'https://example.test/', socialLinks: [],
    regional: { locale: null, timeZone: null, timeFormat: null, weekStartsOn: null } } };
function makeUser(): AuthUser {
  return { userId: snapshot.userId, username: snapshot.values.username, email: snapshot.email!,
    firstName: snapshot.values.firstName, lastName: snapshot.values.lastName, role: 'member', status: 'active',
    passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false,
    properties: {}, createdAt: 1, updatedAt: null };
}
let context = { user: makeUser(), activeTenant: { tenantId: 'tenant-a', kind: 'organization' as const,
  slug: 'a', name: 'A', role: 'member' }, accessToken: 'synthetic-not-a-credential', refreshToken: null,
  isLoading: false, isRestoring: false, error: null, authenticationContinuation: null,
  sessionTransition: { phase: 'idle' as const, operation: null, revision: 0, recoverable: false, error: null } };
const auth = {
  get user() { return context.user; }, get activeTenant() { return context.activeTenant; },
  get isAuthenticated() { return Boolean(context.user); }, get isLoading() { return false; }, get isRestoring() { return false; },
  get sessionTransition() { return context.sessionTransition; }, get authorizationScopeKey() { return scope; },
  authorizationState: { status: 'ready', snapshot: null, error: null },
  store: { getSnapshot: () => ({ context }) },
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  async getConfig(): Promise<AuthPublicConfig> { return { registration: { mode: 'disabled', bootstrapRequired: false,
    publicRegistrationEnabled: false }, userProfile: { ...structuredClone(snapshot.capabilities),
      ...(contactsEnabled ? { contacts: structuredClone(contactSnapshot.capabilities) } : {}),
      ...(avatarsEnabled ? { avatars: structuredClone(avatarSnapshot.capabilities) } : {}) } }; },
};
interface Receipt {
  readonly input: UpdateUserProfileInput;
  readonly signal?: AbortSignal;
  readonly snapshot: UserProfileSnapshot;
  resolve(value: UserProfileSnapshot): void;
  reject(cause: unknown): void;
}
const calls: Receipt[] = [];
interface ContactReceipt { action: string; input: Record<string, unknown>; signal?: AbortSignal; previous: UserContactSnapshot;
  resolve(value: UserContactSnapshot): void; reject(cause: unknown): void }
const contactCalls: ContactReceipt[] = [];
const completions: { token: string; signal?: AbortSignal; resolve(value: EmailContactVerificationResult): void; reject(cause: unknown): void }[] = [];
const verified: string[] = [];
interface AvatarReceipt { image?: Blob; revision: number; signal?: AbortSignal; previous: UserAvatarSnapshot;
  resolve(value: UserAvatarSnapshot): void; reject(cause: unknown): void }
const avatarCalls: AvatarReceipt[] = [], avatarDeliveries: { signal?: AbortSignal; id: string }[] = [];
let avatarBytes: Blob | null = null;
const contactAction = (action: string, input: Record<string, unknown>, signal?: AbortSignal) => new Promise<UserContactSnapshot>((resolve, reject) => {
  contactCalls.push({ action, input: structuredClone(input), signal, previous: structuredClone(contactSnapshot), resolve, reject });
});
const client = { auth, _authorizationDataBoundary: data, presence: {
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => presenceState,
}, userProfile: {
  async get() {
    gets++;
    if (holdProfileRead) { holdProfileRead = false; return new Promise<UserProfileSnapshot>(resolve => profileReads.push({ value: structuredClone(snapshot), resolve })); }
    return structuredClone(snapshot);
  },
  update(input: UpdateUserProfileInput, signal?: AbortSignal) {
    return new Promise<UserProfileSnapshot>((resolve, reject) => {
      calls.push({ input: structuredClone(input), signal, snapshot: structuredClone(snapshot), resolve, reject });
    });
  },
}, userContacts: {
  async get() { if (failContactRead) { failContactRead = false; throw new Error('PRIVATE_CONTACT_READ_FAILURE'); } return structuredClone(contactSnapshot); },
  setPhone: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('setPhone', input, signal),
  requestEmailVerification: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('emailVerify', input, signal),
  requestEmailChange: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('emailChange', input, signal),
  requestPhoneVerification: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('phoneVerify', input, signal),
  completePhone: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('phoneComplete', input, signal),
  cancelChallenge: (input: Record<string, unknown>, signal?: AbortSignal) => contactAction('cancel', input, signal),
  completeEmail: (token: string, signal?: AbortSignal) => new Promise<EmailContactVerificationResult>((resolve, reject) => completions.push({ token, signal, resolve, reject })),
}, userAvatar: {
  async get() { return structuredClone(avatarSnapshot); },
  replace(image: Blob, revision: number, signal?: AbortSignal) {
    return new Promise<UserAvatarSnapshot>((resolve, reject) => avatarCalls.push({ image, revision, signal, previous: structuredClone(avatarSnapshot), resolve, reject }));
  },
  remove(revision: number, signal?: AbortSignal) {
    return new Promise<UserAvatarSnapshot>((resolve, reject) => avatarCalls.push({ revision, signal, previous: structuredClone(avatarSnapshot), resolve, reject }));
  },
  async deliver(asset: { id: string }, signal?: AbortSignal) {
    avatarDeliveries.push({ id: asset.id, signal }); return avatarBytes ?? new Blob([], { type: 'image/webp' });
  },
} } as unknown as Client;
const config = getAuthConfigController(auth);
const harness = {
  calls, contactCalls, completions, verified, observations, observationEvents, avatarCalls, avatarDeliveries, profileReads, avatarAcceptedCallbacks, gets: () => gets,
  showAvatarConsumer: (_deferred = false) => {},
  rejectAvatarAccepted(index: number) { avatarAcceptedCallbacks[index]!.reject(new Error('PRIVATE_AVATAR_CALLBACK_FAILURE')); },
  holdNextProfileRead() { holdProfileRead = true; },
  resolveProfileRead(index: number) { const read = profileReads[index]!; read.resolve(read.value); },
  resolveForeignProfileRead(index: number) {
    const read = profileReads[index]!;
    read.resolve({ ...read.value, userId: 'foreign-account', email: 'FOREIGN_PROFILE_EMAIL',
      values: { ...read.value.values, firstName: 'FOREIGN_PROFILE_NAME' } });
  },
  showLanding: (_token?: string, _throwCallback = false) => {},
  replaceProof: (_token: string) => {},
  resolveCompletion(index: number) { completions[index]!.resolve({ verified: true, userId: 'account-a', requiresSignIn: false }); },
  async enableAvatars(shape: UserAvatarCapabilities['shape'] = 'circle') {
    avatarsEnabled = true; avatarSnapshot = { ...avatarSnapshot, capabilities: { ...avatarCapabilities, shape } };
    snapshot = { ...snapshot, capabilities: { ...snapshot.capabilities, avatars: avatarSnapshot.capabilities } };
    await config.refresh();
    for (const fn of listeners) fn();
  },
  resolveAvatar(index: number) {
    const call = avatarCalls[index]!, accepted = structuredClone(call.previous); accepted.revision = call.revision + 1;
    avatarBytes = call.image ?? null;
    accepted.asset = call.image ? { id: 'ava_00000000-0000-0000-0000-000000000000', width: 512, height: 512,
      byteLength: call.image.size, mimeType: 'image/webp', deliveryPath: '/auth/profile/avatar/assets/ava_00000000-0000-0000-0000-000000000000' } : null;
    if (avatarSnapshot.userId === accepted.userId) { avatarSnapshot = structuredClone(accepted); snapshot = { ...snapshot, revision: accepted.revision }; }
    call.resolve(accepted);
  },
  rejectAvatar(index: number, conflict = false) { avatarCalls[index]!.reject({ code: conflict ? 'AUTH_PROFILE_REVISION_CONFLICT' : 'AUTH_AVATAR_IMAGE_INVALID', status: conflict ? 409 : 422 }); },
  async setAvatarPolicy(editable: boolean) {
    avatarSnapshot = { ...avatarSnapshot, capabilities: { ...avatarSnapshot.capabilities, editable } };
    snapshot = { ...snapshot, capabilities: { ...snapshot.capabilities, avatars: avatarSnapshot.capabilities } };
    await config.refresh();
  },
  setAvatarPresence(enabled: boolean, stale = false) {
    presenceState = !enabled ? EMPTY_GUARDIAN_PRESENCE : { ...EMPTY_GUARDIAN_PRESENCE, status: 'ready',
      capabilities: { enabled: true, state: 'ready', topology: 'single-owner', statuses: [{ key: 'available', label: 'Available', tone: 'success', selectable: true }],
        heartbeatIntervalMs: 15000, idleAfterMs: 300000, awayAfterMs: 600000, serverTime: Date.now(), ownerLeaseDurationMs: 60000,
        canReportActivity: false, canSetIntent: false },
      observations: { [snapshot.userId]: { userId: snapshot.userId, status: 'available', connected: true, revision: 1,
        ownerEpoch: 1, updatedAt: Date.now(), freshUntil: Date.now() + 60000, stale } } };
    for (const fn of listeners) fn();
  },
  push: (_path: string) => {}, setProps: (_props: UserProfileSettingsProps) => {},
  resolve(index: number, canonicalName?: string) {
    const call = calls[index]!, previous = call.snapshot, { regional, ...identity } = call.input.changes;
    const accepted: UserProfileSnapshot = { ...previous, revision: previous.revision + 1,
      values: { ...previous.values, ...identity, ...(canonicalName ? { firstName: canonicalName } : {}),
        regional: { ...previous.values.regional, ...regional } } };
    if (snapshot.userId === previous.userId) snapshot = structuredClone(accepted);
    call.resolve(accepted);
  },
  resolveForeignProfile(index: number) {
    const call = calls[index]!;
    call.resolve({ ...call.snapshot, userId: 'foreign-account', email: 'FOREIGN_PROFILE_EMAIL', revision: 91,
      values: { ...call.snapshot.values, firstName: 'FOREIGN_PROFILE_NAME' } });
  },
  reject(index: number, conflict = false) { calls[index]!.reject(conflict
    ? { code: 'AUTH_PROFILE_REVISION_CONFLICT', status: 409, private: 'NEVER_RENDER_OR_LOG' }
    : new Error('NEVER_RENDER_OR_LOG')); },
  rejectUsername(index: number) { calls[index]!.reject({ code: 'DUPLICATE_USERNAME', status: 409, message: 'NEVER_RENDER_OR_LOG' }); },
  async enableUsername() {
    snapshot = { ...snapshot, capabilities: { ...snapshot.capabilities,
      fields: { ...snapshot.capabilities.fields, username: { enabled: true, editable: true, required: true } } } };
    await config.refresh();
  },
  installLatest() { snapshot = { ...snapshot, revision: 7, values: { ...snapshot.values, firstName: 'Other writer' } }; },
  async enableContacts(proof: 'unverified' | 'administratively-attested' | 'possession-verified' = 'unverified', delivery = true) {
    contactsEnabled = true;
    contactSnapshot.capabilities = { ...contactCapabilities, email: { ...contactCapabilities.email, verifyReady: delivery, changeReady: delivery },
      phone: { ...contactCapabilities.phone, verifyReady: delivery } };
    contactSnapshot.email = { ...contactSnapshot.email!, state: proof, verifiedAt: proof === 'unverified' ? null : 1 };
    await config.refresh();
  },
  failNextContactRead() { failContactRead = true; },
  resolveContact(index: number) {
    const call = contactCalls[index]!, accepted = structuredClone(call.previous); accepted.revision++;
    const id = `acc_${index === 0 ? '00000000' : '11111111'}-0000-0000-0000-000000000000`;
    const clear = { pendingValue: null, challengeId: null, expiresAt: null };
    if (call.action === 'setPhone') accepted.phone = { value: call.input.phone as string | null, state: call.input.phone === null ? 'absent' : 'unverified', verifiedAt: null, ...clear };
    if (call.action === 'emailVerify' || call.action === 'emailChange') accepted.email = { ...accepted.email!, state: 'pending', verifiedAt: null,
      pendingValue: call.action === 'emailChange' ? String(call.input.email) : accepted.email!.value, challengeId: id, expiresAt: Date.now() + 900_000 };
    if (call.action === 'phoneVerify') accepted.phone = { ...accepted.phone!, state: 'pending', pendingValue: accepted.phone!.value, challengeId: id, expiresAt: Date.now() + 900_000 };
    if (call.action === 'phoneComplete') accepted.phone = { ...accepted.phone!, state: 'possession-verified', verifiedAt: Date.now(), ...clear };
    if (call.action === 'cancel') {
      const channel = accepted.email?.challengeId === call.input.challengeId ? 'email' : 'phone';
      accepted[channel] = { ...accepted[channel]!, state: 'unverified', verifiedAt: null, ...clear };
    }
    if (contactSnapshot.userId === accepted.userId) contactSnapshot = structuredClone(accepted);
    call.resolve(accepted);
  },
  rejectContact(index: number, code = 'AUTH_CONTACT_CODE_INVALID') { contactCalls[index]!.reject({ code, status: code === 'AUTH_CONTACT_REVISION_CONFLICT' || code === 'DUPLICATE_EMAIL' ? 409 : 422 }); },
  async narrowContactCapabilities() {
    contactSnapshot = { ...contactSnapshot, email: null, phone: null, capabilities: { ...contactSnapshot.capabilities,
      email: { readable: false, verifyReady: false, changeReady: false }, phone: { readable: false, enabled: true, editable: false, verifyReady: false } } };
    await config.refresh();
  },
  async contactDeliveryUnavailable() {
    contactSnapshot.capabilities = { ...contactSnapshot.capabilities, email: { ...contactSnapshot.capabilities.email, verifyReady: false, changeReady: false },
      phone: { ...contactSnapshot.capabilities.phone, verifyReady: false } };
    if (contactSnapshot.email?.challengeId) contactSnapshot.email.state = 'delivery-unavailable';
    if (contactSnapshot.phone?.challengeId) contactSnapshot.phone.state = 'delivery-unavailable';
    await config.refresh();
  },
  async setPolicy(state: UserProfileCapabilities['state'], lockedFirstName = false) {
    snapshot = { ...snapshot, capabilities: capabilities(state) };
    if (lockedFirstName) snapshot.capabilities.fields.firstName = { enabled: true, editable: false, required: false };
    await config.refresh();
  },
  async nativeReadOnlyProjection() {
    snapshot = { ...snapshot, email: null, capabilities: { ...snapshot.capabilities,
      fields: Object.fromEntries(Object.entries(snapshot.capabilities.fields).map(([field, rule]) => [field, { ...rule, editable: false }])) as UserProfileCapabilities['fields'],
      regional: { ...snapshot.capabilities.regional, editable: false } } };
    await config.refresh();
  },
  replaceUser(notify = true) {
    scope = 'account-b'; snapshot = { ...snapshot, userId: 'account-b', email: 'other@example.test', revision: 20,
      values: { ...snapshot.values, firstName: 'Other', username: 'other@example.test' } };
    context = { ...context, user: makeUser() }; if (notify) for (const fn of listeners) fn();
    contactSnapshot = { ...contactSnapshot, userId: 'account-b', revision: 20,
      email: { value: 'other@example.test', state: 'unverified', verifiedAt: null, pendingValue: null, expiresAt: null, challengeId: null },
      phone: { value: null, state: 'absent', verifiedAt: null, pendingValue: null, expiresAt: null, challengeId: null } };
    avatarSnapshot = { ...avatarSnapshot, userId: 'account-b', revision: 20, asset: null };
  },
  notify() { for (const fn of listeners) fn(); },
  retire() { auth.authorizationState = { status: 'error', snapshot: null, error: null }; data.invalidate(); },
};
declare global { interface Window { __profileSettings: typeof harness } }
window.__profileSettings = harness;
configureFrontendObservability({ sink: { emit(event) { observations.push(event.code); observationEvents.push(event); } } });
function Fixture() {
  const [props, setProps] = React.useState<UserProfileSettingsProps>({ security: false, additionalProperties: false });
  const [landing, setLanding] = React.useState<{ token?: string; throwCallback?: boolean } | null>(null);
  const [avatarConsumer, setAvatarConsumer] = React.useState<boolean | null>(null);
  harness.showAvatarConsumer = (deferred = false) => setAvatarConsumer(deferred);
  harness.showLanding = (token, throwCallback = false) => setLanding({ token, throwCallback });
  harness.replaceProof = token => setLanding(old => ({ ...old, token }));
  const router = useRouter(); harness.push = path => router.push(path); harness.setProps = next => setProps(old => ({ ...old, ...next }));
  return <main className="mx-auto max-w-3xl p-4">{avatarConsumer !== null ? <AvatarEditor profile={snapshot} onAccepted={async () => {
    if (avatarConsumer) await new Promise<never>((_resolve, reject) => avatarAcceptedCallbacks.push({ reject }));
    else throw new Error('PRIVATE_AVATAR_CALLBACK_FAILURE');
  }} /> : landing ? <ContactEmailVerification token={landing.token} onVerified={result => {
    verified.push(result.userId); if (landing.throwCallback) throw new Error('NEVER_RENDER_OR_LOG');
  }} /> : <UserProfileSettings {...props} />}</main>;
}
createRoot(document.getElementById('root')!).render(<ClientProvider client={client}><RouterProvider><Fixture /></RouterProvider></ClientProvider>);
