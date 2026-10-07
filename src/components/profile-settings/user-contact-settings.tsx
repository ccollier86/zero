'use client';

/** Connected contact section. Phone drafts share Zero form semantics; security proofs remain separate ceremonies. */
import { useEffect, useId, useRef, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useUserContacts, type UseUserContactsResult } from '../../frontend/client/user-contact-hooks';
import type { AuthUserContactTransport } from '../../frontend/client/auth-user-contact-transport';
import type { UserContactSnapshot } from '../../auth/auth-user-contact-types';
import { userContactError } from '../../frontend/client/user-contact-errors';
import { defineSchema, field } from '../../schema';
import { useForm } from '../../hooks/use-form';
import { useFormSave } from '../../hooks/use-form-save';
import { PhoneInput, type PhoneInputProps } from '../phone-input';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { UnsavedChangesDialog } from '../form-save';
import { UserContactProofBadge } from './user-contact-proof-badge';
import { UserContactEmail } from './profile-contact-email';

const phoneSchema = defineSchema({ phone: field.phone() });
export interface UserContactSettingsProps {
  readOnly?: boolean;
  defaultCountry?: PhoneInputProps['defaultCountry'];
  className?: string;
}
export function UserContactSettings({ readOnly = false, defaultCountry = 'US', className }: UserContactSettingsProps) {
  const config = useAuthConfig(), boundary = useAuthorizationScopeBoundary();
  const policy = config.status === 'ready' ? config.config?.userProfile?.contacts : undefined;
  const contacts = useUserContacts({ enabled: policy?.state === 'ready', capabilityKey: JSON.stringify(policy) });
  const [reload, setReload] = useState(0);
  if (config.status === 'ready' && (!policy || policy.state === 'disabled')) return null;
  if (config.isLoading || !boundary.ready || contacts.isLoading) return <p role="status" className="profile-settings__hint">Loading your contact settings…</p>;
  if (!contacts.snapshot) return <section className={className} aria-label="Contact settings">
    <p role="alert" className="profile-settings__contact-error">{policy?.state === 'blocked'
      ? 'Contact settings need a database migration before they can be used. Contact your administrator.'
      : contacts.error ?? 'Contact settings are unavailable on this server.'}</p>
    <Button type="button" size="sm" variant="ghost" onClick={() => { void config.reload().then(() => contacts.refresh()); }}><RefreshCw />Retry contact settings</Button>
  </section>;
  return <ContactEditor key={`${boundary.key}:${reload}:${readOnly}:${JSON.stringify(contacts.snapshot.capabilities)}`}
    contacts={contacts} snapshot={contacts.snapshot} readOnly={readOnly} defaultCountry={defaultCountry} className={className}
    reload={async () => { await contacts.refresh(); setReload(old => old + 1); }} />;
}

function ContactEditor({ contacts, snapshot, readOnly, defaultCountry, className, reload }: UserContactSettingsProps & {
  contacts: UseUserContactsResult; snapshot: UserContactSnapshot; reload(): Promise<void>;
}) {
  const id = useId(), [code, setCode] = useState(''), [ceremonyError, setCeremonyError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const current = Date.now(), future = [snapshot.email?.expiresAt, snapshot.phone?.expiresAt]
      .filter((value): value is number => typeof value === 'number' && value > current);
    if (!future.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(2_147_483_647, Math.min(...future) - current + 1)));
    return () => clearTimeout(timer);
  }, [snapshot.email?.expiresAt, snapshot.phone?.expiresAt, now]);
  const [ceremonyPending, setCeremonyPending] = useState(false), operation = useRef<AbortController | null>(null), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current?.abort(); }; }, []);
  const locked = readOnly || !snapshot.capabilities.phone.editable;
  const form = useForm({ schema: phoneSchema, defaultValues: { phone: snapshot.phone?.value ?? null }, baseline: 'accepted',
    initialRevision: snapshot.revision, scopeKey: snapshot.userId,
    onSubmit: async (values, context) => {
      if (locked) throw new Error('Phone editing is not available.');
      const accepted = await contacts.mutate(api => api.setPhone({ expectedRevision: Number(context.expectedRevision),
        phone: values.phone == null || values.phone === '' ? null : String(values.phone) }, context.signal), context.signal);
      return { values: { phone: accepted.phone?.value ?? null }, revision: accepted.revision };
    } });
  const save = useFormSave({ form, scopeKey: snapshot.userId });
  const run = async (action: (api: AuthUserContactTransport, signal: AbortSignal) => Promise<UserContactSnapshot>, signal?: AbortSignal, rethrow = false) => {
    if (readOnly || operation.current || form.isSubmitting) {
      if (rethrow) throw new Error('Contact saving is not available while another operation is pending.');
      return;
    }
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) throw new DOMException('Contact draft retired.', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true }); operation.current = controller;
    // These acknowledged ceremonies do not edit phone values, but advance the
    // independent contact revision. Keep every outstanding phone draft intact.
    const captured = form.captureValues([]);
    setCeremonyPending(true); setCeremonyError(null);
    try {
      const accepted = await contacts.mutate(api => action(api, controller.signal), controller.signal);
      if (!active.current || controller.signal.aborted || operation.current !== controller) return;
      form.acceptValues({ revision: accepted.revision }, captured); setCode('');
    } catch (cause) {
      if (active.current && !controller.signal.aborted && operation.current === controller
        && !(cause instanceof DOMException && cause.name === 'AbortError')) setCeremonyError(userContactError(cause));
      if (rethrow) throw cause;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (operation.current === controller) { operation.current = null; if (active.current) setCeremonyPending(false); }
    }
  };
  const phone = form.register('phone'), pending = !readOnly && (contacts.isSaving || form.isSubmitting || ceremonyPending);
  const phoneChanged = (phone.value || null) !== snapshot.phone?.value;
  const challenge = snapshot.phone?.challengeId, expires = snapshot.phone?.expiresAt;
  const expired = expires !== null && expires !== undefined && expires <= Math.max(now, Date.now());
  if (!snapshot.email && !snapshot.phone) return null;
  return <section data-slot="user-contact-settings" className={className} aria-label="Contact settings">
    <header className="profile-settings__section-header"><h3>Contact settings</h3><p>Manage how we reach you. Formatting a number or sending a message does not prove ownership.</p></header>
    <div className="profile-settings__fields">
      <UserContactEmail snapshot={snapshot} readOnly={readOnly} pending={pending} error={ceremonyError}
        verify={() => run((api, signal) => api.requestEmailVerification({ expectedRevision: snapshot.revision }, signal))}
        cancel={() => run((api, signal) => api.cancelChallenge({ expectedRevision: snapshot.revision, challengeId: snapshot.email!.challengeId! }, signal))}
        change={(email, currentPassword, signal) => run((api, signal) => api.requestEmailChange({ expectedRevision: snapshot.revision, email, currentPassword }, signal), signal, true)} />
      {snapshot.capabilities.phone.enabled && snapshot.capabilities.phone.readable && snapshot.phone && <div className="profile-settings__field">
        <Label htmlFor={id} className="profile-settings__label">Phone number</Label>
        <div className="min-w-0 space-y-2">
          <div className="profile-settings__control profile-settings__phone-control"><PhoneInput id={id} ref={phone.ref} value={String(phone.value ?? '')} defaultCountry={defaultCountry}
            readOnly={locked} aria-invalid={Boolean(phone.error)} onChange={value => form.setValue('phone', value === '' ? null : value)} onBlur={phone.onBlur} />
            {!locked && form.isDirty && <div className="profile-settings__field-actions">
              <Button type="button" size="icon" variant="ghost" className="size-7 text-success" aria-label="Save phone number" disabled={pending || form.hasConflict}
                onClick={() => { void save.save(); }}><Check /></Button>
              <Button type="button" size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Cancel phone number changes" disabled={pending}
                onClick={() => save.discard()}><X /></Button>
            </div>}
          </div>
          <UserContactProofBadge state={snapshot.phone.state} unsaved={phoneChanged} expired={expired} />
          {phone.error && <p role="alert" className="profile-settings__contact-error">{phone.error}</p>}
          {phoneChanged && <p className="profile-settings__hint">Save this number before requesting verification.</p>}
          {!readOnly && snapshot.capabilities.phone.verifyReady && !phoneChanged && snapshot.phone.value && snapshot.phone.state !== 'possession-verified' && !challenge
            && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { void run((api, signal) => api.requestPhoneVerification({ expectedRevision: snapshot.revision }, signal)); }}><ShieldCheck />Verify phone number</Button>}
          {challenge && <div className="profile-settings__contact-pending">
            <p className="profile-settings__hint">{expired ? 'This verification has expired. Cancel it and request another.' : 'Enter the code from your verification message. A code request is not proof of ownership.'}</p>
            {!readOnly && snapshot.capabilities.phone.verifyReady && !phoneChanged && !expired && <form className="profile-settings__contact-code" onSubmit={event => {
              event.preventDefault(); if (!code.trim()) return;
              void run((api, signal) => api.completePhone({ expectedRevision: snapshot.revision, challengeId: challenge, code: code.trim() }, signal));
            }}>
              <Input aria-label="Phone verification code" autoComplete="one-time-code" maxLength={32} value={code} onChange={event => setCode(event.target.value)} disabled={pending} />
              <Button type="submit" size="sm" disabled={pending || !code.trim()}>Verify code</Button>
            </form>}
            {!readOnly && (snapshot.capabilities.phone.cancelReady ?? (snapshot.capabilities.phone.editable || snapshot.capabilities.phone.verifyReady)) && <Button type="button" size="sm" variant="ghost" disabled={pending}
              onClick={() => { void run((api, signal) => api.cancelChallenge({ expectedRevision: snapshot.revision, challengeId: challenge }, signal)); }}><X />Cancel phone verification</Button>}
          </div>}
          {!readOnly && !snapshot.capabilities.phone.verifyReady && snapshot.phone.state !== 'possession-verified'
            && <p className="profile-settings__hint">Phone verification is not available for this session or server.</p>}
        </div>
      </div>}
    </div>
    {(save.error || ceremonyError || contacts.error) && <p role="alert" className="profile-settings__contact-error">{ceremonyError ?? contacts.error ?? save.error}</p>}
    {(form.hasConflict || ceremonyError) && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { void save.requestLeave(reload); }}><RefreshCw />Review latest contact settings</Button>}
    <UnsavedChangesDialog controller={save} />
  </section>;
}
