/**
 * Qualifies installed profile/settings SDK, configuration and UI facades.
 * No live app, provider, profile database or Fabric actor is started.
 */
// Bun has no direct directory-creation/temp-directory/removal API.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('installed adaptive profile facades browser/server-build, typecheck and render without domain services', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(`${SCRATCH}/profile-settings-package-`);
  const consumer = `${root}/consumer`, archive = `${root}/framework.tgz`;
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(`${consumer}/package.json`, JSON.stringify({
      name: 'zero-profile-settings-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
        typescript: '5.9.3', '@types/bun': '1.3.10', '@types/react': '19.2.14', '@types/react-dom': '19.2.3' },
    }));
    await Bun.write(`${consumer}/consumer.tsx`, CONSUMER);
    await Bun.write(`${consumer}/verify.ts`, VERIFY);
    await Bun.write(`${consumer}/server-consumer.ts`, SERVER_CONSUMER);
    await Bun.write(`${consumer}/public-types.ts`, PUBLIC_TYPES);
    await checked(['install', '--ignore-scripts'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      browserBytes: number; serverBytes: number; html: string; exports: boolean; recovery: boolean;
      sdk: boolean; schema: boolean; config: boolean; realm: boolean; guides: boolean; notices: boolean; styles: boolean; queryHelpers: boolean; authorizationHelpers: boolean;
    };
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.serverBytes).toBeGreaterThan(0);
    expect(result.exports).toBe(true);
    expect(result.recovery).toBe(true);
    expect(result.sdk).toBe(true);
    expect(result.schema).toBe(true);
    expect(result.config).toBe(true);
    expect(result.realm).toBe(true);
    expect(result.guides).toBe(true);
    expect(result.notices).toBe(true);
    expect(result.styles).toBe(true);
    expect(result.queryHelpers).toBe(true);
    expect(result.authorizationHelpers).toBe(true);
    expect(result.html).toContain('Public reviewers');
    expect(result.html).toContain('data-shape="square"');
    expect(result.html).not.toContain('Busy');
    expect(result.html).not.toContain('avatar-presence-indicator');
    expect(result.html).not.toContain('Add user');
    expect(result.html).toContain('Delivery rules');
    expect(result.html).toContain('Mentions: Email');
    expect(result.html).toContain('Team chat');
    expect(result.html).toContain('Connected');
    expect(result.html).toContain('Actions for Team chat');
    expect(result.html).not.toContain('New Connection');
    expect(result.html).toContain('Ownership verified');
    expect(result.html).toContain('Complete your profile');
    expect(result.html).toContain('You have unsaved changes.');
    expect(result.html).toContain('data-slot="form-save-bar"');
    expect(result.html).toContain('data-slot="kbd-group"');
    expect(result.html).toContain('aria-label="Save shortcut"');
    const archiveSha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
    const manifest = await Bun.file(`${consumer}/node_modules/@zero/framework/package.json`).json() as { version: string };
    console.info(JSON.stringify({ qualification: 'adaptive-profile-installed-working-archive', version: manifest.version,
      archiveSha256, browserBytes: result.browserBytes, serverBytes: result.serverBytes }));
  } finally {
    // Only this freshly allocated fixture is disposable; no app data is opened.
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

async function checked(arguments_: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH,
      BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, 90_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Profile UI consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as ReactParts from '@zero/framework/react';
import { AvatarGroup, AvatarPresenceIndicator } from '@zero/framework/components/avatar-group';
import { SettingsMatrix } from '@zero/framework/components/settings-matrix';
import { IntegrationSettingsList } from '@zero/framework/components/integration-settings-list';
import { UserProfileSettings, UserProfileIdentitySummary, UserProfileFields, UserRegionalSettings,
  UserProfileSecurity, UserContactSettings, UserContactProofBadge, ContactEmailVerification,
  UserPresenceSettings } from '@zero/framework/components/profile-settings';
import { AvatarEditor, AvatarCropDialog } from '@zero/framework/components/avatar-editor';
import { FormSaveBar, UnsavedChangesDialog, useFormSave } from '@zero/framework/components/form-save';
import { ProfileCompletionForm } from '@zero/framework/components/auth';
import { PhoneInput } from '@zero/framework/components/phone-input';
import { Kbd, KbdGroup } from '@zero/framework/components/kbd';
import { stableValueKey, appendDataFilter, appendDataFilters, normalizePage, normalizePageSize,
  buildDataPageQuery, buildResourceListQuery } from '@zero/framework/react/query-params';
import { AuthorizationScopeBoundaryFence, readAuthorizationScopeBoundaryKey, readAuthorizationScopeIdentityKey,
  isAuthorizationScopeCallbackCurrent, isAuthorizationDataReady, isAuthorizationScopeReady,
  isAuthorizationScopeStable, useAuthorizationScopeBoundary } from '@zero/framework/react/authorization-scope';
const idleTransition = { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null } as const;
const scopeFence = new AuthorizationScopeBoundaryFence();
const firstScope = scopeFence.update('first'), repeatedScope = scopeFence.update('first');
const nextScope = scopeFence.update('next');
export const authorizationHelpers = firstScope === repeatedScope && !scopeFence.isCurrent(firstScope)
  && scopeFence.isCurrent(nextScope) && isAuthorizationScopeStable(idleTransition)
  && isAuthorizationScopeReady(idleTransition, false) && !isAuthorizationScopeReady(idleTransition, true)
  && isAuthorizationDataReady(1, 'unauthenticated', false) && !isAuthorizationDataReady(1, 'error', true)
  && isAuthorizationScopeCallbackCurrent('current', true, 'current')
  && !isAuthorizationScopeCallbackCurrent('current', false, 'current')
  && typeof readAuthorizationScopeBoundaryKey(null) === 'string'
  && typeof readAuthorizationScopeIdentityKey(null) === 'string'
  && useAuthorizationScopeBoundary === Root.useAuthorizationScopeBoundary
  && isAuthorizationScopeCallbackCurrent === ReactParts.isAuthorizationScopeCallbackCurrent;
const queryParameters = new URLSearchParams();
appendDataFilter(queryParameters, 'state', { op: 'eq', value: 'active' });
appendDataFilters(queryParameters, { category: ['one', 'two'] });
export const queryHelpers = stableValueKey({ b: 2, a: 1 }) === '{"a":1,"b":2}'
  && queryParameters.getAll('filter').join('|') === 'state:active|category:in:one,two'
  && normalizePage(2.5) === 2 && normalizePageSize(undefined) === 50
  && buildDataPageQuery('items', {}, null, 1, 20) === '/api/data?table=items&limit=20&offset=0'
  && buildResourceListQuery('items') === '/api/resources/items';
const exportedComponents: Array<readonly [string, unknown]> = [
  ['AvatarGroup', AvatarGroup], ['AvatarPresenceIndicator', AvatarPresenceIndicator],
  ['SettingsMatrix', SettingsMatrix], ['IntegrationSettingsList', IntegrationSettingsList],
  ['UserProfileSettings', UserProfileSettings], ['UserProfileIdentitySummary', UserProfileIdentitySummary],
  ['UserProfileFields', UserProfileFields], ['UserRegionalSettings', UserRegionalSettings],
  ['UserProfileSecurity', UserProfileSecurity], ['UserContactSettings', UserContactSettings],
  ['UserContactProofBadge', UserContactProofBadge], ['ContactEmailVerification', ContactEmailVerification],
  ['UserPresenceSettings', UserPresenceSettings], ['AvatarEditor', AvatarEditor], ['AvatarCropDialog', AvatarCropDialog],
  ['FormSaveBar', FormSaveBar], ['UnsavedChangesDialog', UnsavedChangesDialog], ['useFormSave', useFormSave],
  ['ProfileCompletionForm', ProfileCompletionForm], ['PhoneInput', PhoneInput],
  ['Kbd', Kbd], ['KbdGroup', KbdGroup],
  ['useUserProfile', Root.useUserProfile], ['useUserContacts', Root.useUserContacts],
  ['useUserAvatar', Root.useUserAvatar], ['useGuardianPresence', Root.useGuardianPresence],
  ['useAvatarPresence', Root.useAvatarPresence],
];
export const exportsMatch = exportedComponents.every(([name, component]) => component !== undefined
  && (Root as Record<string, unknown>)[name] === component && (ReactParts as Record<string, unknown>)[name] === component);
export const recovery = typeof Root.AuthClient.prototype.recoverSession === 'function'
  && typeof Object.getOwnPropertyDescriptor(Root.AuthClient.prototype, 'hasRecoverableSession')?.get === 'function';
export function Consumer() {
  const controller = useFormSave({ form: { isDirty: true, isSubmitting: false,
    async submit() { return { kind: 'accepted', values: {} }; }, reset() {} }, beforeUnload: false, guardNavigation: false });
  return <main>
    <AvatarGroup aria-label="Public reviewers" role="group" shape="square" members={[
      { id: 'reviewer', name: 'Public reviewer', presence: { label: 'Busy', tone: 'destructive' } },
    ]} />
    <SettingsMatrix title="Delivery rules" columns={[{ id: 'email', label: 'Email' }]}
      rows={[{ id: 'mentions', label: 'Mentions' }]} value={{ mentions: { email: true } }} />
    <IntegrationSettingsList title="Connections" items={[{
      id: 'chat', title: 'Team chat', status: { label: 'Connected', tone: 'success' },
      actions: [{ id: 'review', label: 'Review setup', onSelect() {} }],
    }]} />
    <UserProfileSettings mode="read-only" contacts={false} avatar={false} presence={false} />
    <AvatarEditor readOnly />
    <UserContactProofBadge state="possession-verified" />
    <KbdGroup aria-label="Save shortcut"><Kbd>⌘</Kbd><Kbd>S</Kbd></KbdGroup>
    <ProfileCompletionForm />
    <FormSaveBar controller={controller} placement="inline" />
    <UnsavedChangesDialog controller={controller} />
    <AvatarCropDialog open={false} image={new Blob([], { type: 'image/png' })}
      capabilities={{ enabled: true, editable: true, state: 'ready', shape: 'circle', size: 'default',
        fallback: 'initials', maxUploadBytes: 1024, maxPixels: 4096, outputSize: 64 }}
      onOpenChange={() => {}} onSave={async () => {}} />
  </main>;
}
`;

const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as ts from 'typescript';
import { AuthClient } from '@zero/framework';
import { Consumer, exportsMatch, recovery, queryHelpers, authorizationHelpers } from './consumer';
import { config, schema, realm } from './server-consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const serverBuild = await Bun.build({ entrypoints: ['./server-consumer.ts'], target: 'bun', format: 'esm' });
if (!serverBuild.success) throw new Error(serverBuild.logs.map(log => log.message).join(String.fromCharCode(10)));
const program = ts.createProgram(['./public-types.ts', './consumer.tsx', './server-consumer.ts'], {
  noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  allowImportingTsExtensions: true, resolveJsonModule: true, types: ['bun'], esModuleInterop: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: x => x, getNewLine: () => String.fromCharCode(10) }));
const auth = new AuthClient('https://isolated-public-consumer.invalid');
const sdk = [
  [auth.profile, ['get', 'update']],
  [auth.contacts, ['get', 'setPhone', 'requestEmailVerification', 'requestEmailChange', 'requestPhoneVerification', 'completePhone', 'cancelChallenge', 'completeEmail']],
  [auth.profileCompletion, ['inspect', 'complete']],
  [auth.avatars, ['get', 'stage', 'upload', 'finalize', 'replace', 'cancel', 'remove', 'deliver', 'directory']],
].every(([api, methods]) => methods.every(name => typeof api[name] === 'function'));
auth.dispose();
const base = './node_modules/@zero/framework/';
const guides = (await Promise.all([
  'frontend/components/avatar-group.md', 'frontend/components/settings-matrix.md',
  'frontend/components/integration-settings-list.md', 'frontend/components/phone-input.md',
  'frontend/components/kbd.md',
  'frontend/guardian/profile-settings.md', 'frontend/forms/save-and-leave.md',
  'backend/guardian/user-profiles.md', 'backend/guardian/contacts.md', 'backend/guardian/avatars.md',
  'backend/guardian/presence.md', 'backend/guardian/profile-completion.md',
].map(path => Bun.file(base + 'docs-next/' + path).exists()))).every(Boolean);
const notice = await Bun.file(base + 'THIRD_PARTY_NOTICES.md').text();
const notices = ['c-avatar-29.json', 'react-easy-crop', 'sharp', 'react-phone-number-input', 'libphonenumber-js']
  .every(name => notice.includes(name));
const globals = await Bun.file(new URL(import.meta.resolve('@zero/framework/styles.css'))).text();
const styles = (await Promise.all(['form-save', 'profile-settings', 'avatar-editor', 'kbd'].map(async name =>
  globals.includes('../../components/' + name + '/' + name + '.styles.css')
    && await Bun.file(base + 'src/components/' + name + '/' + name + '.styles.css').exists()))).every(Boolean);
console.log(JSON.stringify({ exports: exportsMatch, recovery, sdk, schema, config, realm, guides, notices, styles, queryHelpers, authorizationHelpers,
  html: renderToString(React.createElement(Consumer)),
  serverBytes: serverBuild.outputs.reduce((sum, item) => sum + item.size, 0),
  browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0) }));
`;

const SERVER_CONSUMER = `
import { defineAuthConfig, resolveAuthBehaviorConfig } from '@zero/framework/auth';
import { guardianPresenceRealmContribution, composeDatabaseRealm, defineDatabaseRealm } from '@zero/framework/server';
import { defineTable, field, isPhoneNumber } from '@zero/framework/schema';
const declaration = defineAuthConfig({ userProfile: { fields: { firstName: { required: true }, preferredName: true },
  regional: { enabled: true, defaults: { locale: 'en-US', timeZone: 'UTC', timeFormat: '12h', weekStartsOn: 1 } },
  contacts: { enabled: true, email: { verify: true }, phone: { enabled: true, editable: true, verify: true } },
  avatars: { enabled: true, shape: 'rounded', outputSize: 64 }, completion: { enabled: true } },
  presence: { enabled: true, onCallEnabled: true } });
const resolved = resolveAuthBehaviorConfig(declaration);
export const config = resolved.userProfile.fields.firstName.required && resolved.userProfile.contacts.phone.verify
  && resolved.userProfile.avatars.enabled && resolved.userProfile.completion.enabled && resolved.presence.enabled;
const table = defineTable('package_profile_contacts', { phone: field.phone({ defaultCountry: 'US', validation: 'possible' }) }, { pk: 'id', sync: 'full' });
export const schema = isPhoneNumber('+12025550123') && !isPhoneNumber('+') && table.serverTable.phone === 'text';
const base = defineDatabaseRealm({ name: 'installed-profile-schema', version: '1', tables: { contacts: table.serverTable } });
const composed = composeDatabaseRealm({ name: 'installed-presence', version: '1',
  contributions: [guardianPresenceRealmContribution()] });
export const realm = base.tables.contacts.phone === 'text' && typeof composed.queries['guardian.presence.current'] === 'function'
  && composed.migrations.some(item => item.version === 'guardian_presence_001');
`;

/** Installed type qualification uses documented package paths, never private source imports. */
const PUBLIC_TYPES = `
import type { Client, AuthSessionRecoveryResult, AuthProfileCompletionRequiredResult, UserProfileSnapshot,
  UserContactSnapshot, UserAvatarSnapshot, UserAvatarStage, UserProfileCompletion,
  GuardianPresenceClient, UseUserProfileOptions, UseUserContactsOptions, UseUserAvatarOptions } from '@zero/framework';
import type { UserProfileSettingsProps } from '@zero/framework/components/profile-settings';
import type { AvatarCropDialogProps } from '@zero/framework/components/avatar-editor';
import type { UseFormSaveOptions, FormSaveBarProps } from '@zero/framework/components/form-save';
import type { ProfileCompletionFormProps } from '@zero/framework/components/auth';
import type { AuthUserProfileConfig, AuthUserContactConfig, AuthUserAvatarConfig,
  AuthUserProfileCompletionConfig, AuthPresenceConfig, PhoneVerificationAdapter } from '@zero/framework/server';
import type { NativeIdentityScope } from '@zero/framework/native';
import type { KbdProps, KbdGroupProps } from '@zero/framework/components/kbd';
import type { DataFilterExpression, DataPageInfo } from '@zero/framework/react/query-params';
import type { AuthorizationScopeBoundary } from '@zero/framework/react/authorization-scope';
import { field } from '@zero/framework/schema';
export const nativeScopes: NativeIdentityScope[] = ['openid', 'profile', 'email', 'phone', 'profile:write', 'contacts:write'];
// @ts-expect-error Application RBAC grants are not native identity/own-account scopes.
const forbiddenScope: NativeIdentityScope = 'application.manage';
export const profileConfig: AuthUserProfileConfig = { fields: { firstName: { required: true } }, regional: true };
export const contactConfig: AuthUserContactConfig = { enabled: true, phone: { enabled: true, verify: true } };
export const avatarConfig: AuthUserAvatarConfig = { enabled: true, shape: 'square', size: 'sm' };
export const completionConfig: AuthUserProfileCompletionConfig = { enabled: true, existingUsers: 'none' };
export const presenceConfig: AuthPresenceConfig = { enabled: true, customStatuses: [{ key: 'focus', label: 'Focus', tone: 'primary' }] };
export const optionalPhone = field.phone({ defaultCountry: 'FR', validation: 'valid', defaultValue: null });
export type PublishedContracts = [UserProfileSnapshot, UserContactSnapshot, UserAvatarSnapshot, UserAvatarStage,
  UserProfileCompletion, AuthProfileCompletionRequiredResult, AuthSessionRecoveryResult, GuardianPresenceClient,
  UseUserProfileOptions, UseUserContactsOptions, UseUserAvatarOptions, UserProfileSettingsProps,
  AvatarCropDialogProps, UseFormSaveOptions, FormSaveBarProps, ProfileCompletionFormProps, PhoneVerificationAdapter,
  KbdProps, KbdGroupProps, DataFilterExpression, DataPageInfo, AuthorizationScopeBoundary];
export function ownedApis(client: Client) {
  const ownProfile: Client['userProfile'] = client.userProfile;
  const ownContacts: Client['userContacts'] = client.userContacts;
  const ownAvatar: Client['userAvatar'] = client.userAvatar;
  const completion: Client['userProfileCompletion'] = client.userProfileCompletion;
  const presence: Client['presence'] = client.presence;
  return { ownProfile, ownContacts, ownAvatar, completion, presence };
}
`;
