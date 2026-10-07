'use client';

/** Adaptive own-profile organism. Guardian owns policy; existing form helpers own drafts. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useUserProfile, type UseUserProfileResult } from '../../frontend/client/user-profile-hooks';
import { useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorization } from '../../frontend/client/authorization-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useForm } from '../../hooks/use-form';
import { useFormSave } from '../../hooks/use-form-save';
import { isFormRevisionConflict } from '../../hooks/form-acceptance-controller';
import { FormSaveBar, UnsavedChangesDialog } from '../form-save';
import { UserPropertiesForm } from '../auth/user-properties-form';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { UserProfileSnapshot, UserProfileField } from '../../auth/auth-user-profile-types';
import { createProfileSettingsSchema, profileSettingsDraft, profileSettingsChanges, profileDisplayName,
  profileInitials, changedProfileSettingsFields, type ProfileSettingsDraft } from './profile-draft';
import { UserProfileFields } from './profile-settings-fields';
import { UserRegionalSettings } from './profile-settings-regional';
import { UserProfileSecurity } from './profile-settings-security';
import { UserContactSettings } from './user-contact-settings';
import { UserPresenceSettings } from './user-presence-settings';
import { AvatarEditor } from '../avatar-editor';
import type { UserAvatarSnapshot } from '../../auth/auth-user-avatar-types';
import { userProfilePolicyKey } from '../../frontend/client/user-profile-policy';
import { userProfileError } from '../../frontend/client/user-profile-errors';

export interface UserProfileSettingsProps {
  mode?: 'full' | 'compact' | 'read-only';
  /** Field mode adds explicit small check/cancel actions; blur never saves. */
  saveMode?: 'page' | 'field';
  saveBar?: 'floating' | 'inline' | false;
  security?: boolean;
  /** Contact settings use distinct security ceremonies, not the cosmetic profile Save action. */
  contacts?: boolean;
  /** Optional connected private avatar editor; disabled server policy still omits it. */
  avatar?: boolean;
  /** Optional availability section; a disabled SDK/server presence policy omits it. */
  presence?: boolean;
  additionalProperties?: boolean;
  className?: string;
  /** App-specific extension content, never an authority override. */
  children?: ReactNode;
}

/** Drop into a ClientProvider/AppProvider; no user/organization ID configuration needed. */
export function UserProfileSettings(props: UserProfileSettingsProps) {
  const config = useAuthConfig(), boundary = useAuthorizationScopeBoundary();
  const retainedPolicy = useRef<{ key: string; policy: UserProfileSnapshot['capabilities'] | undefined } | null>(null);
  if (config.status === 'ready') retainedPolicy.current = { key: boundary.key, policy: config.config?.userProfile };
  const policy = config.config?.userProfile
    ?? (config.status !== 'ready' && retainedPolicy.current?.key === boundary.key ? retainedPolicy.current.policy : undefined);
  const profile = useUserProfile({ enabled: policy?.state === 'ready', capabilityKey: userProfilePolicyKey(policy) });
  const [reload, setReload] = useState(0);
  if (policy?.state === 'disabled') return null;
  if (!boundary.ready || !profile.snapshot && (config.isLoading || profile.isLoading)) return <p role="status" className="text-sm text-muted-foreground">Loading your profile…</p>;
  if (!profile.snapshot) return <section className="profile-settings__unavailable" aria-label="Profile settings">
    <h2>Profile settings</h2><p role="alert">{policy?.state === 'blocked'
      ? 'Profile settings need a database migration before they can be used. Contact your administrator.'
      : profile.error ?? 'Profile settings are unavailable on this server.'}</p>
    <Button type="button" size="sm" variant="outline" onClick={() => { void config.reload().then(() => profile.refresh()); }}><RefreshCw />Retry</Button>
  </section>;
  return <UserProfileSettingsEditor key={`${boundary.key}:${reload}:${props.mode === 'read-only' ? 'readonly' : 'editable'}:${userProfilePolicyKey(policy)}`}
    {...props} policyPending={config.status !== 'ready'} policyError={config.status === 'error'} onRetryPolicy={() => { void config.reload(); }}
    profile={profile} snapshot={policy ? { ...profile.snapshot, capabilities: policy } : profile.snapshot}
    onReload={async () => { await profile.refresh(); setReload(old => old + 1); }} />;
}

/** Independently reusable summary; roles are read-only live authorization hints. */
export function UserProfileIdentitySummary({ snapshot, roles = [], avatar }: {
  snapshot: UserProfileSnapshot; roles?: readonly { label: string; scope: string }[];
  /** Optional avatar presentation/editor. The default initials stay backward compatible. */
  avatar?: ReactNode;
}) {
  return <header className="profile-settings__identity">
    {avatar ?? <Avatar className="profile-settings__avatar"><AvatarFallback>{profileInitials(snapshot)}</AvatarFallback></Avatar>}
    <div className="min-w-0"><h2 className="truncate">{profileDisplayName(snapshot)}</h2>
      {snapshot.email && <p className="truncate text-sm text-muted-foreground">{snapshot.email}</p>}
      {roles.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Assigned roles">
        {roles.map(role => <Badge variant="outline" key={`${role.scope}:${role.label}`} title={`${role.scope} role`}>{role.label}<span className="sr-only"> · {role.scope}</span></Badge>)}
      </div>}
    </div>
  </header>;
}

function UserProfileSettingsEditor({ snapshot, profile, onReload, mode = 'full', saveMode = 'page',
  saveBar, security = true, contacts = true, avatar = true, presence = true, additionalProperties = true, className, children,
  policyPending = false, policyError = false, onRetryPolicy }: UserProfileSettingsProps & {
  snapshot: UserProfileSnapshot; profile: UseUserProfileResult; onReload(): Promise<void>;
  policyPending?: boolean;
  policyError?: boolean;
  onRetryPolicy(): void;
}) {
  const authorization = useAuthorization(), readOnly = mode === 'read-only' || policyPending;
  const authConfig = useAuthConfig();
  const avatarPolicy = authConfig.status === 'ready' ? authConfig.config?.userProfile?.avatars : undefined;
  const schema = useMemo(() => createProfileSettingsSchema(snapshot.capabilities), [snapshot.capabilities]);
  const initial = useRef(profileSettingsDraft(snapshot));
  const baseline = useRef(initial.current), fieldPending = useRef(false);
  const fieldConflict = useRef(false);
  const fieldOperation = useRef<AbortController | null>(null);
  const fieldActive = useRef(true);
  const [savingField, setSavingField] = useState<UserProfileField | null>(null), [fieldError, setFieldError] = useState<string | null>(null);
  const latestField = useRef({ readOnly }); latestField.current = { readOnly };
  useEffect(() => {
    fieldActive.current = true;
    return () => { fieldActive.current = false; fieldOperation.current?.abort(); fieldOperation.current = null; fieldPending.current = false; };
  }, []);
  useEffect(() => {
    if (!readOnly) return;
    fieldOperation.current?.abort(); fieldOperation.current = null; fieldPending.current = false;
    setSavingField(null); setFieldError(null);
  }, [readOnly]);
  const form = useForm<ProfileSettingsDraft>({ schema, defaultValues: initial.current,
    baseline: 'accepted', initialRevision: snapshot.revision, scopeKey: snapshot.userId,
    onSubmit: async (encoded, context) => {
      if (readOnly || fieldPending.current) throw new Error('Profile saving is not available.');
      if (fieldConflict.current) throw { code: 'REVISION_CONFLICT' };
      const draft = schema.decodeRow(encoded) as ProfileSettingsDraft;
      const accepted = await profile.update(profileSettingsChanges(draft, changedProfileSettingsFields(draft, baseline.current),
        Number(context.expectedRevision), snapshot.capabilities), context.signal);
      baseline.current = profileSettingsDraft(accepted);
      return { values: schema.encodeRow(baseline.current) as ProfileSettingsDraft, revision: accepted.revision };
    },
  });
  const save = useFormSave({ form: {
    get isDirty() { return form.isDirty; },
    get isSubmitting() { return form.isSubmitting || fieldPending.current; },
    submit: () => form.submit(), reset: () => form.reset(),
  }, scopeKey: snapshot.userId });
  const roles = [
    ...(authorization.authorization?.scope?.roles ?? []).map(label => ({ label, scope: authorization.authorization?.scope?.kind ?? 'workspace' })),
    ...(authorization.authorization?.applicationScope?.roles ?? []).map(label => ({ label, scope: 'platform' })),
  ];
  const commitField = async (field: UserProfileField) => {
    if (readOnly || fieldPending.current || fieldConflict.current || form.hasConflict || form.isSubmitting || !form.validateFields([field])) return;
    const captured = form.captureValues([field]);
    const operation = new AbortController(); fieldOperation.current = operation;
    const current = () => fieldActive.current && fieldOperation.current === operation
      && !operation.signal.aborted && !latestField.current.readOnly;
    fieldPending.current = true; setSavingField(field); setFieldError(null);
    try {
      const accepted = await profile.update(profileSettingsChanges(form.getValues(), [field],
        Number(captured.expectedRevision), snapshot.capabilities), operation.signal);
      if (!current()) return;
      const values = profileSettingsDraft(accepted);
      if (form.acceptValues({ values: schema.encodeRow(values) as ProfileSettingsDraft, revision: accepted.revision }, captured)) {
        baseline.current = values;
      }
    } catch (cause) {
      if (current() && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        fieldConflict.current = isFormRevisionConflict(cause);
        setFieldError(userProfileError(cause));
      }
    } finally {
      if (fieldOperation.current === operation) {
        fieldOperation.current = null; fieldPending.current = false;
        if (fieldActive.current) setSavingField(null);
      }
    }
  };
  const placement = saveBar === undefined ? saveMode === 'page' ? 'floating' : 'inline' : saveBar;
  const acceptedAvatar = (accepted: UserAvatarSnapshot) => {
    if (accepted.userId !== snapshot.userId || accepted.revision <= Number(form.revision)) return;
    // Avatar and profile share a CAS revision. Adopt only a strictly newer
    // acknowledged revision, not another field's values or unsubmitted draft.
    const captured = form.captureValues([]);
    form.acceptValues({ values: schema.encodeRow(form.getValues()) as ProfileSettingsDraft, revision: accepted.revision }, captured);
  };
  return <div data-slot="user-profile-settings" data-mode={mode} className={cn('profile-settings', className)}>
    {policyPending && <div className="profile-settings__section"><p role={policyError ? 'alert' : 'status'} className="profile-settings__hint">
      {policyError ? 'Profile policy could not be refreshed. Your draft is retained; editing is paused.' : 'Refreshing profile policy. Your draft is retained; editing is paused.'}
    </p>{policyError && <Button type="button" size="sm" variant="ghost" onClick={onRetryPolicy}>Retry policy</Button>}</div>}
    <UserProfileIdentitySummary snapshot={snapshot} roles={roles} avatar={avatar && avatarPolicy?.enabled
      ? <AvatarEditor profile={snapshot} expectedRevision={Number(form.revision)} readOnly={readOnly} onAccepted={acceptedAvatar}
        onReviewLatest={() => save.requestLeave(onReload)} /> : undefined} />
    <form onSubmit={event => { event.preventDefault(); if (!readOnly) void save.save(); }}>
      <section className="profile-settings__section" aria-label="Profile">
        <header className="profile-settings__section-header"><h3>Your profile</h3><p>Your personal information, across all your workspaces.</p></header>
        <UserProfileFields form={form} capabilities={snapshot.capabilities} readOnly={readOnly}
          pending={!readOnly && (profile.isSaving || Boolean(savingField))} fieldActions={saveMode === 'field'}
          saveBlocked={fieldConflict.current || form.hasConflict}
          saveField={commitField} discardField={field => form.setValue(field, baseline.current[field])} />
        {fieldError && <p role="alert" className="text-sm text-destructive mt-3">{fieldError}</p>}
        {(form.hasConflict || fieldError || profile.error) && <Button type="button" variant="ghost" size="sm"
          onClick={() => { void save.requestLeave(onReload); }}><RefreshCw />Review latest profile</Button>}
      </section>
      <UserRegionalSettings form={form} capabilities={snapshot.capabilities} readOnly={readOnly}
        pending={!readOnly && (profile.isSaving || Boolean(savingField))} />
    </form>
    {contacts && <UserContactSettings readOnly={readOnly} className="profile-settings__section" />}
    {presence && <UserPresenceSettings readOnly={readOnly} />}
    {security && <UserProfileSecurity readOnly={readOnly} />}
    {additionalProperties && !readOnly && <section className="profile-settings__additional"><UserPropertiesForm title="Additional settings"
      description="The extra settings this application lets you control." emptyState={null} /></section>}
    {children}
    {!readOnly && placement && <FormSaveBar controller={save} placement={placement} />}
    <UnsavedChangesDialog controller={save} />
  </div>;
}
