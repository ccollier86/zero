/** Desired-vs-installed Guardian profile capabilities; inspection never starts a service or provider. */
import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedConfig } from '../frontend/server/types';
import { normalizeAuthUserProfile } from '../auth/auth-config-user-profile';
import type { ResolvedAuthUserProfileConfig } from '../auth/auth-user-profile-types';
import { inspectUserProfileSchema } from '../auth/auth-user-profile-schema';
import { inspectUserContactSchema } from '../auth/auth-user-contact-schema';
import { inspectUserAvatarSchema } from '../auth/auth-user-avatar-schema';
import { inspectProfileCompletionSchema } from '../auth/auth-user-profile-completion-schema';
import { profileCompletionPolicyFingerprint } from '../auth/auth-user-profile-completion-policy';
import { inspectInstalledUserProfilePolicy, userProfilePolicyFingerprint } from '../auth/auth-user-profile-policy';
import { normalizeAuthPresence } from '../auth/auth-config-presence';
import { presenceSystemSchemaReady } from '../presence/presence-schema';
import { presenceProjectionSchemaReady } from '../presence/presence-projection-schema';
import { hasGuardianPresenceRealm } from '../presence/presence-realm';
import { addPlatformDoctorFinding as addFinding, type PlatformDoctorFindingSink } from './platform-doctor-contracts';
import { hasSQLiteTable, tableHasRequiredColumns } from './platform-doctor-system-database-inspection';

const GUARDIAN_DOCS = './docs-next/backend/guardian';
type SchemaState = 'ready' | 'missing' | 'invalid';
export interface DoctorGuardianProfileFeatures {
  readonly profile: ResolvedAuthUserProfileConfig;
  readonly presenceEnabled: boolean;
  readonly pinnedPresence: boolean;
  readonly phoneAdapterId: string | null;
}

/** Configuration-only prerequisites; trusted adapter callbacks are deliberately not invoked. */
export function checkGuardianProfileFeatureConfiguration(resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink): DoctorGuardianProfileFeatures | null {
  if (resolved.auth === false) return null;
  const profile = normalizeAuthUserProfile(resolved.auth.userProfile);
  const presenceEnabled = normalizeAuthPresence(resolved.auth.presence).enabled;
  const tenancy = typeof resolved.auth.tenancy === 'string' ? resolved.auth.tenancy : resolved.auth.tenancy?.mode ?? 'single';
  const physicalTenants = tenancy === 'multi' && resolved.databaseTopology.mode === 'multiple'
    && resolved.databaseTopology.tenantIsolation === 'tenant-database';
  if (presenceEnabled && physicalTenants && resolved.databaseTopology.mode === 'multiple'
    && !hasGuardianPresenceRealm(resolved.databaseTopology.realm)) {
    addFinding(findings, { severity: 'error', code: 'auth.presence.realm_missing', path: 'databaseTopology.realm',
      message: 'Configured tenant presence is missing its exact Guardian realm contribution.',
      hint: 'Compose guardianPresenceRealmContribution() identically into the gateway and actor realm, retaining it when presence is disabled. Doctor does not start actors or inspect tenant files.',
      docs: `${GUARDIAN_DOCS}/presence.md` });
  }
  if (profile.enabled && profile.contacts.enabled) {
    if ((profile.contacts.email.verify || profile.contacts.email.change) && resolved.email === false) {
      addFinding(findings, { severity: 'warning', code: 'auth.user_profile.contacts.email_delivery_unconfigured', path: 'email',
        message: 'Email contact proof is configured without the managed Email service.',
        hint: 'Configure the existing Email runtime and public link branding; Doctor does not test delivery readiness or send verification messages.',
        docs: `${GUARDIAN_DOCS}/contacts.md` });
    }
    if (profile.contacts.phone.enabled && profile.contacts.phone.verify && !resolved.auth.phoneVerificationAdapter) {
      addFinding(findings, { severity: 'warning', code: 'auth.user_profile.contacts.phone_adapter_unconfigured', path: 'auth.phoneVerificationAdapter',
        message: 'Phone proof is configured without a trusted phone verification adapter.',
        hint: 'Supply the explicit trusted adapter if phone proof is required. Doctor does not invoke isReady/start/verify/cancel or imply that a phone value is verified.',
        docs: `${GUARDIAN_DOCS}/contacts.md` });
    }
  }
  return Object.freeze({ profile, presenceEnabled, pinnedPresence: presenceEnabled && !physicalTenants,
    phoneAdapterId: resolved.auth.phoneVerificationAdapter?.id ?? null });
}

/** Reuse each feature's exact native schema admission without constructing its mutable store. */
export function checkGuardianProfileFeatureState(database: Database, features: DoctorGuardianProfileFeatures,
  findings: PlatformDoctorFindingSink): void {
  const db = readonlyAdapter(database), profile = features.profile;
  if (profile.enabled) {
    if (reportSchema(inspectUserProfileSchema(db), 'profile', '039', 'auth.userProfile', 'user-profiles.md', findings)) {
      checkUserProfilePolicy(db, profile, features.phoneAdapterId, findings);
    }
    if (profile.contacts.enabled) reportSchema(inspectUserContactSchema(db), 'contacts', '041',
      'auth.userProfile.contacts', 'contacts.md', findings);
    if (profile.avatars.enabled && reportSchema(inspectUserAvatarSchema(db), 'avatars', '042',
      'auth.userProfile.avatars', 'avatars.md', findings)) checkAvatarNamespace(database, findings);
    if (profile.completion.enabled && reportSchema(inspectProfileCompletionSchema(db), 'completion', '043',
      'auth.userProfile.completion', 'profile-completion.md', findings)) checkCompletionPolicy(database, profile, findings);
  }
  if (features.presenceEnabled) {
    const ready = presenceSystemSchemaReady(db);
    addFinding(findings, { severity: ready ? 'info' : 'error', code: ready ? 'auth.presence.schema_ready' : 'auth.presence.schema_unready',
      path: 'auth.presence', message: ready ? 'The installed SYSTEM presence schema matches its exact declared contract.'
        : 'Configured presence is missing or has incompatible SYSTEM schema objects.',
      hint: ready ? 'Schema admission alone does not prove a live owner, actor publication or current availability.'
        : 'Use the reviewed SYSTEM migration 040. Doctor does not create tables, reclaim presence owners or publish projections.',
      docs: `${GUARDIAN_DOCS}/presence.md` });
  }
}

/** Pinned applications need their own readonly projection; physical tenants stay behind Fabric before-use admission. */
export function checkGuardianPresenceApplicationState(database: Database, features: DoctorGuardianProfileFeatures,
  findings: PlatformDoctorFindingSink): void {
  if (!features.pinnedPresence) return;
  const ready = presenceProjectionSchemaReady(readonlyAdapter(database));
  addFinding(findings, { severity: ready ? 'info' : 'error', code: ready ? 'auth.presence.application_ready' : 'auth.presence.application_unready',
    path: 'db', message: ready ? 'The pinned application presence projection schema matches its exact contract.'
      : 'Configured presence has no admitted pinned application projection schema.',
    hint: ready ? 'This does not prove an active current owner or successful SYSTEM publication.'
      : 'Allow the supported presence-only application migration on normal startup, or apply a reviewed projection migration. Doctor does not mutate the pinned database.',
    docs: `${GUARDIAN_DOCS}/presence.md` });
}

function reportSchema(state: SchemaState, feature: string, migration: string, path: string, page: string,
  findings: PlatformDoctorFindingSink): boolean {
  addFinding(findings, { severity: state === 'ready' ? 'info' : 'error',
    code: `auth.user_profile.${feature}.schema_${state}`, path,
    message: state === 'ready' ? `The installed SYSTEM ${feature} schema matches its exact declared contract.`
      : `Configured ${feature} has ${state === 'missing' ? 'missing' : 'incompatible'} SYSTEM schema objects.`,
    hint: state === 'ready' ? 'This is schema admission, not proof of live feature/provider readiness.'
      : state === 'missing' ? `Apply the reviewed SYSTEM migration ${migration}; managed migrate:false must not create it opportunistically.`
        : 'Keep the deployment stopped and resolve the schema collision with a reviewed migration; Doctor does not overwrite framework-owned objects.',
    docs: `${GUARDIAN_DOCS}/${page}` });
  return state === 'ready';
}

function checkAvatarNamespace(database: Database, findings: PlatformDoctorFindingSink): void {
  const columns = ['drive_id', 'public', 'tenant_id', 'owner_id'];
  if (!hasSQLiteTable(database, 'storage_drives') || !tableHasRequiredColumns(database, 'storage_drives', columns)) {
    namespaceFinding('storage_missing', 'Guardian avatar media has no inspectable SYSTEM Storage drive metadata.', findings); return;
  }
  const row = database.query(`SELECT d.drive_id,d.public,d.tenant_id,d.owner_id FROM _auth_avatar_namespace n
    LEFT JOIN storage_drives d ON d.drive_id=n.drive_id WHERE n.singleton=1`).get() as {
      drive_id: string | null; public: number | null; tenant_id: string | null; owner_id: string | null;
    } | null;
  if (!row || !row.drive_id) namespaceFinding('namespace_missing', 'Guardian avatar media namespace has not been provisioned.', findings);
  else if (row.public !== 0 || row.tenant_id !== null || row.owner_id !== null) {
    namespaceFinding('namespace_invalid', 'Guardian avatar media namespace is not a private global SYSTEM drive.', findings);
  } else addFinding(findings, { severity: 'info', code: 'auth.user_profile.avatars.namespace_ready', path: 'auth.userProfile.avatars',
    message: 'Guardian avatar metadata points to a private global SYSTEM media namespace.',
    hint: 'Doctor does not download staged files, read avatar bytes, call providers or test delivery.', docs: `${GUARDIAN_DOCS}/avatars.md` });
}
function namespaceFinding(reason: string, message: string, findings: PlatformDoctorFindingSink): void {
  addFinding(findings, { severity: 'error', code: `auth.user_profile.avatars.${reason}`, path: 'auth.userProfile.avatars', message,
    hint: reason === 'namespace_invalid' ? 'Resolve the media ownership/privacy collision through reviewed platform operations; do not make the drive public.'
      : 'Use normal managed startup with admitted provisioning. With migrate:false, the existing private namespace must already be installed.',
    docs: `${GUARDIAN_DOCS}/avatars.md` });
}
function checkCompletionPolicy(database: Database, profile: ResolvedAuthUserProfileConfig, findings: PlatformDoctorFindingSink): void {
  const row = database.query('SELECT policy_fingerprint,updated_at FROM _auth_profile_completion_policy WHERE singleton=1').get() as {
    policy_fingerprint: string; updated_at: number;
  } | null;
  const valid = row && typeof row.policy_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.policy_fingerprint)
    && Number.isSafeInteger(row.updated_at) && row.updated_at >= 0;
  if (row && !valid) {
    addFinding(findings, { severity: 'error', code: 'auth.user_profile.completion.policy_invalid', path: 'auth.userProfile.completion',
      message: 'The installed completion policy marker is malformed.', hint: 'Resolve the private state invariant through reviewed recovery; Doctor does not replace it.',
      docs: `${GUARDIAN_DOCS}/profile-completion.md` });
  } else if (!row || row.policy_fingerprint !== profileCompletionPolicyFingerprint(profile)) {
    addFinding(findings, { severity: 'warning', code: 'auth.user_profile.completion.policy_pending', path: 'auth.userProfile.completion',
      message: 'The desired completion policy has not been reconciled by the current Guardian runtime.',
      hint: 'Start/recompose the app normally under the declared policy, then rerun Doctor; do not manually rewrite stored proofs or fingerprints.',
      docs: `${GUARDIAN_DOCS}/profile-completion.md` });
  }
}
function checkUserProfilePolicy(db: Pick<ReactiveDB, 'prepare'>, profile: ResolvedAuthUserProfileConfig,
  phoneAdapterId: string | null, findings: PlatformDoctorFindingSink): void {
  let row;
  try { row = inspectInstalledUserProfilePolicy(db); }
  catch {
    addFinding(findings, { severity: 'error', code: 'auth.user_profile.profile.policy_invalid', path: 'auth.userProfile',
      message: 'The installed user-profile policy generation is malformed.',
      hint: 'Resolve the private state invariant through reviewed recovery. Doctor does not install or replace policy generations.',
      docs: `${GUARDIAN_DOCS}/user-profiles.md` }); return;
  }
  if (!row || row.policy_fingerprint !== userProfilePolicyFingerprint(profile, phoneAdapterId)) {
    addFinding(findings, { severity: 'warning', code: 'auth.user_profile.profile.policy_pending', path: 'auth.userProfile',
      message: 'The desired user-profile policy has not been reconciled by the current Guardian runtime.',
      hint: 'Start/recompose Guardian normally under the declared policy. Only bootstrap installs its generation; Doctor never adopts policy or revives old runtimes.',
      docs: `${GUARDIAN_DOCS}/user-profiles.md` });
  }
}
function readonlyAdapter(database: Database): Pick<ReactiveDB, 'prepare'> {
  return { prepare: (sql: string) => database.query(sql) } as Pick<ReactiveDB, 'prepare'>;
}
