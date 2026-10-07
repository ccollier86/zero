'use client';

/** Reusable first-use profile form. Existing form helpers own drafts; the SDK owns the restricted proof/session exchange. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthCompletionResult, AuthProfileCompletionRequiredResult } from '../../frontend/client/auth-types';
import { useAuth } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { useForm } from '../../hooks/use-form';
import { useFormSave } from '../../hooks/use-form-save';
import { UnsavedChangesDialog } from '../form-save';
import { UserProfileFields } from '../profile-settings/profile-settings-fields';
import { createProfileSettingsSchema, profileSettingsDraft, profileSettingsChanges,
  changedProfileSettingsFields, type ProfileSettingsDraft } from '../profile-settings/profile-draft';
import { USER_PROFILE_FIELDS, type UserProfileSnapshot, type UserProfileCapabilities, type UserProfileField } from '../../auth/auth-user-profile-types';
import type { UserProfileCompletion } from '../../auth/auth-user-profile-completion-types';
import { Button } from '../ui/button';
import { AuthHeader } from './auth-header';
import { AuthFlowContinuation } from './auth-flow-continuation';
import { isAuthFlowContinuationResult, isAuthSessionResult, isProfileCompletionRequiredResult } from './auth-continuation';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';
import { cn } from '../../lib/utils';

export interface ProfileCompletionFormProps {
  /** Omit on the optional public route to use the current in-memory auth continuation. */
  result?: AuthProfileCompletionRequiredResult;
  onComplete?(result: AuthCompletionResult): void;
  onSuccess?(): void;
  onBack?(): void;
  className?: string;
}
/** Enabled required profile fields only: no app Bearer token, contact proof, avatar, role or membership mutation is invented. */
export function ProfileCompletionForm(props: ProfileCompletionFormProps) {
  const { authenticationContinuation } = useAuth();
  const client = useClientMaybe(), auth = (client as InternalClient | null)?.auth;
  const result = props.result ?? authenticationContinuation;
  if (isAuthFlowContinuationResult(result) && !isProfileCompletionRequiredResult(result)) {
    return <AuthFlowContinuation result={result} onSuccess={props.onSuccess} onBack={props.onBack} className={props.className} />;
  }
  if (!isProfileCompletionRequiredResult(result)) return <div className={cn('space-y-4', props.className)}>
    <AuthHeader title="Complete your profile" description="Start sign-in again to securely load your required profile information." />
    <p role="status" className="text-sm text-muted-foreground">This page does not have a current profile completion request. Completion links do not carry account credentials.</p>
    {props.onBack && <Button type="button" variant="outline" className="w-full" onClick={props.onBack}>Back to sign in</Button>}
  </div>;
  if (auth && (auth.isAuthenticated || auth.hasRecoverableSession
    || authenticationContinuation && (!isProfileCompletionRequiredResult(authenticationContinuation)
      || authenticationContinuation.user.userId !== result.user.userId
      || authenticationContinuation.profileCompletion.continuation !== result.profileCompletion.continuation))) {
    return <p role="status" className="text-sm text-muted-foreground">This profile completion request is no longer current. Continue with the current sign-in flow.</p>;
  }
  return <ProfileCompletionScope key={profileCompletionFlowKey(result)} {...props} result={result} />;
}

function ProfileCompletionScope({ result, ...props }: ProfileCompletionFormProps & { result: AuthProfileCompletionRequiredResult }) {
  const client = useClientMaybe(), auth = (client as InternalClient | null)?.auth;
  const [completion, setCompletion] = useState(result.profileCompletion), [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(true), operation = useRef<AbortController | null>(null);
  useEffect(() => { current.current = true; return () => { current.current = false; operation.current?.abort(); }; }, []);
  const refresh = async () => {
    if (!auth || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setLoading(true); setError(null);
    try {
      const next = await auth.profileCompletion.inspect(completion.continuation, controller.signal);
      if (current.current && operation.current === controller && next.profile?.userId !== undefined && next.profile.userId !== result.user.userId) throw new Error('Profile identity changed. Start sign-in again.');
      if (current.current && operation.current === controller) setCompletion(next);
    } catch (cause) {
      if (current.current && operation.current === controller && !controller.signal.aborted) {
        reportAuthClientActionFailure('profileCompletionInspect', cause, { codeOnly: true });
        setError('Required profile information could not be loaded. Retry, or start sign-in again.');
      }
    } finally { if (operation.current === controller) { operation.current = null; if (current.current) setLoading(false); } }
  };
  if (!completion.profile || completion.state !== 'ready') return <div className={cn('space-y-4', props.className)} aria-busy={loading}>
    <AuthHeader title="Complete your profile" description="Required profile information must be saved before entering the application." />
    <p role="alert" className="text-sm text-muted-foreground">Profile completion needs a database migration or configuration update. Contact your administrator, then retry.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="button" className="w-full" disabled={!auth || loading} onClick={() => { void refresh(); }}>{loading ? 'Loading required profile…' : 'Retry required profile'}</Button>
    {props.onBack && <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={props.onBack}>Back to sign in</Button>}
  </div>;
  return <ProfileCompletionEditor key={JSON.stringify([completion.profile.revision, completion.profile.capabilities])}
    {...props} snapshot={completion.profile} completion={completion} onRefresh={refresh} loading={loading} />;
}

function ProfileCompletionEditor({ snapshot, completion, onRefresh, loading, onComplete, onSuccess, onBack, className }: ProfileCompletionFormProps & {
  snapshot: UserProfileSnapshot; completion: UserProfileCompletion; onRefresh(): Promise<void>; loading: boolean;
}) {
  const client = useClientMaybe(), auth = (client as InternalClient | null)?.auth;
  // This local view narrows rendering/validation only. The original server
  // policy remains authoritative for the request and final admission.
  const requiredPolicy = useMemo(() => requiredCompletionPolicy(snapshot.capabilities), [snapshot.capabilities]);
  const requiredFields = useMemo(() => USER_PROFILE_FIELDS.filter(field => requiredPolicy.fields[field].enabled), [requiredPolicy]);
  const schema = useMemo(() => createProfileSettingsSchema(requiredPolicy), [requiredPolicy]);
  const initial = useRef(profileSettingsDraft(snapshot));
  const form = useForm<ProfileSettingsDraft>({ schema, defaultValues: initial.current, baseline: 'accepted',
    includeFields: requiredFields,
    initialRevision: snapshot.revision, scopeKey: completion.continuation,
    onSubmit: async (encoded, context) => {
      if (!auth) throw new Error('Start sign-in again to complete your profile.');
      const draft = schema.decodeRow(encoded) as ProfileSettingsDraft;
      const fields = changedProfileSettingsFields(draft, initial.current).filter(key => requiredFields.includes(key as UserProfileField));
      const input = profileSettingsChanges(draft, fields, Number(context.expectedRevision), snapshot.capabilities);
      const next = await auth.profileCompletion.complete({ continuation: completion.continuation, ...input }, context.signal);
      // Installing a full session intentionally retires this anonymous form.
      // Only the exact accepted result may notify routing after that unmount;
      // a later replacement account/family must never receive its callback.
      const accepted = isAuthSessionResult(next)
        ? auth.user?.userId === next.user.userId && auth.accessToken === next.accessToken
        : continuationMatches(auth.authenticationContinuation, next);
      if (!accepted) return;
      onComplete?.(next); if (isAuthSessionResult(next)) onSuccess?.();
    },
  });
  const save = useFormSave({ form, scopeKey: completion.continuation });
  const pending = save.isSaving || loading;
  const managedRequired = completion.missingFields.some(field => !snapshot.capabilities.fields[field].editable);
  return <div className={cn('profile-settings space-y-4', className)} data-slot="profile-completion-form">
    <AuthHeader title="Complete your profile" description="Add the required information before continuing. Your application session starts only after this step is accepted." />
    <form onSubmit={event => { event.preventDefault(); void save.save(); }} aria-busy={pending}>
      <UserProfileFields form={form} capabilities={requiredPolicy} readOnly={!auth} pending={pending} />
      {managedRequired && <p role="status" className="mt-3 text-sm text-muted-foreground">Some required profile information is managed by your administrator. Ask them to update it, then review the latest profile.</p>}
      {(save.error || form.hasConflict) && <p role="alert" className="mt-3 text-sm text-destructive">
        {form.hasConflict ? 'Your profile changed. Review the latest values before continuing.' : 'Your profile could not be completed. Check the fields and retry.'}
      </p>}
      {(save.error || form.hasConflict || managedRequired) && <Button type="button" variant="outline" className="mt-3 w-full" disabled={pending}
        onClick={() => { void save.requestLeave(onRefresh); }}>Review latest profile</Button>}
      <Button type="submit" className="mt-4 w-full" disabled={!auth || managedRequired || pending || form.hasConflict}>
        {save.isSaving ? 'Completing profile…' : 'Continue'}
      </Button>
      {onBack && <Button type="button" variant="ghost" className="mt-2 w-full" disabled={pending}
        onClick={() => { void save.requestLeave(onBack); }}>Back to sign in</Button>}
    </form>
    <UnsavedChangesDialog controller={save} />
  </div>;
}
function requiredCompletionPolicy(policy: UserProfileCapabilities): UserProfileCapabilities {
  return { ...policy, fields: Object.fromEntries(USER_PROFILE_FIELDS.map(field => [field,
    { ...policy.fields[field], enabled: policy.fields[field].enabled && policy.fields[field].required },
  ])) as UserProfileCapabilities['fields'] };
}
/** @internal Stable reset boundary: requirements or another account's proof cannot inherit a previous draft. */
export function profileCompletionFlowKey(result: AuthProfileCompletionRequiredResult): string {
  return JSON.stringify([result.user.userId, result.profileCompletion.continuation, result.profileCompletion.expiresAt,
    result.profileCompletion.state, result.profileCompletion.profile?.revision ?? null,
    result.profileCompletion.profile?.capabilities ?? null, result.profileCompletion.missingFields]);
}
function continuationMatches(current: AuthCompletionResult | null, accepted: AuthCompletionResult): boolean {
  if (!current || current.user.userId !== accepted.user.userId) return false;
  if (isAuthFlowContinuationResult(current) && isAuthFlowContinuationResult(accepted)) {
    if (isProfileCompletionRequiredResult(current) && isProfileCompletionRequiredResult(accepted)) return current.profileCompletion.continuation === accepted.profileCompletion.continuation;
    if ('tenantSelection' in current && 'tenantSelection' in accepted) return current.tenantSelection.continuation === accepted.tenantSelection.continuation;
    if ('onboarding' in current && 'onboarding' in accepted) return current.onboarding.continuation === accepted.onboarding.continuation;
    if ('mfaSetupToken' in current && 'mfaSetupToken' in accepted) return current.mfaSetupToken === accepted.mfaSetupToken;
    if ('mfaChallenge' in current && 'mfaChallenge' in accepted) return current.mfaChallenge.challengeToken === accepted.mfaChallenge.challengeToken;
  }
  return false;
}
