'use client';

/** Security-sensitive candidate email ceremony using Zero's existing dialog and password/form controls. */
import { useId, useState, useRef } from 'react';
import { Mail, Pencil, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { PasswordInput } from '../auth/password-input';
import { ControlledModal } from '../../modals/modal-controlled';
import { createModalFormGuard } from '../../modals/modal-form';
import { UnsavedChangesDialog } from '../form-save';
import { useForm } from '../../hooks/use-form';
import { useFormSave } from '../../hooks/use-form-save';
import { defineSchema, field } from '../../schema';
import type { UserContactSnapshot } from '../../auth/auth-user-contact-types';
import { UserContactProofBadge } from './user-contact-proof-badge';

const emailSchema = defineSchema({ email: field.email({ required: true, maxLength: 254 }),
  currentPassword: field.text({ required: true, minLength: 1, maxLength: 1024 }) });
export interface UserContactEmailProps {
  snapshot: UserContactSnapshot;
  readOnly?: boolean;
  pending: boolean;
  error?: string | null;
  verify(): Promise<void>;
  cancel(): Promise<void>;
  change(email: string, currentPassword: string, signal: AbortSignal): Promise<void>;
}
export function UserContactEmail({ snapshot, readOnly, pending, error, verify, cancel, change }: UserContactEmailProps) {
  const [changing, setChanging] = useState(false), id = useId();
  const trigger = useRef<Element | null>(null);
  const contact = snapshot.email, capabilities = snapshot.capabilities.email;
  if (!capabilities.readable || !contact) return null;
  const expired = contact.expiresAt !== null && contact.expiresAt <= Date.now();
  return <div className="profile-settings__field">
    <Label htmlFor={id} className="profile-settings__label">Sign-in email</Label>
    <div className="min-w-0 space-y-2">
      <div className="profile-settings__contact-heading"><Input id={id} value={contact.value ?? ''} readOnly autoComplete="email" className="profile-settings__input" />
        <UserContactProofBadge state={contact.state} expired={expired} /></div>
      {contact.state === 'administratively-attested' && <p className="profile-settings__hint">Attested by an administrator, not verified by opening an email link.</p>}
      {contact.challengeId && <div className="profile-settings__contact-pending">
        <p className="profile-settings__hint">{expired ? 'This verification has expired. Cancel it and request another.' : contact.pendingValue !== contact.value ? <>Verify <strong>{contact.pendingValue}</strong> using the link sent to that address. Your sign-in email stays unchanged until then.</>
          : 'Check your inbox and open the verification link. Sending a link does not verify this address.'}</p>
        {!readOnly && (capabilities.cancelReady ?? (capabilities.verifyReady || capabilities.changeReady)) && <Button type="button" size="sm" variant="ghost" disabled={pending}
          onClick={() => { void cancel(); }}><X />Cancel email verification</Button>}
      </div>}
      {!readOnly && <div className="profile-settings__contact-actions">
        {capabilities.verifyReady && contact.value && contact.state !== 'possession-verified' && !contact.challengeId && <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => { void verify(); }}><Mail />Verify email</Button>}
        {capabilities.changeReady && !contact.challengeId && <Button type="button" size="sm" variant="ghost" disabled={pending}
          onClick={event => { trigger.current = event.currentTarget; setChanging(true); }}><Pencil />Change email</Button>}
      </div>}
      {!capabilities.verifyReady && !capabilities.changeReady && !readOnly && contact.state !== 'possession-verified'
        && <p className="profile-settings__hint">Email verification or changes are not available for this session or server.</p>}
      {changing && <EmailChangeDraft key={snapshot.userId} userId={snapshot.userId} trigger={trigger.current}
        pending={pending} error={error} change={change} close={() => setChanging(false)} />}
    </div>
  </div>;
}
function EmailChangeDraft({ userId, pending, error, change, close, trigger }: {
  userId: string; pending: boolean; error?: string | null; change(email: string, password: string, signal: AbortSignal): Promise<void>; close(): void;
  trigger: Element | null;
}) {
  const prefix = useId();
  const form = useForm({ schema: emailSchema, defaultValues: { email: '', currentPassword: '' }, baseline: 'accepted', scopeKey: userId,
    onSubmit: async (values, context) => {
      await change(String(values.email), String(values.currentPassword), context.signal);
      // Passwords never become an accepted reset baseline or remain after delivery.
      return { values: { email: '', currentPassword: '' } };
    } });
  const save = useFormSave({ form, scopeKey: userId });
  const email = form.register('email'), password = form.register('currentPassword');
  const formId = `email-change-${prefix}`;
  return <ControlledModal open identityKey={userId} busy={pending || save.isSaving} dirty={save.isDirty} error={error ?? save.error}
    onOpenChange={open => { if (!open) close(); }} descriptor={{
      title: 'Change your sign-in email', icon: <Mail />, size: 'sm', trigger,
      customSize: { width: 'var(--profile-settings-dialog-width,28rem)' },
      description: 'Your current email remains active until you verify the new address. You will need to sign in again after it changes.',
      beforeClose: createModalFormGuard(save),
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel', variant: 'ghost' },
        { id: 'save', label: save.isSaving ? 'Sending verification…' : 'Send verification link', variant: 'primary', submit: true,
          formId, disabled: pending || save.isSaving, onClick: async () => {
            const result = await save.save();
            // Failed/blocked/retired writes and newer drafts keep the dialog.
            // Acknowledgment closes through the manager, never owner retirement.
            return result.kind === 'accepted' && !form.isDirty;
          } }],
      body: <><form id={formId} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor={`${prefix}-email`}>New email address</Label>
          <Input id={`${prefix}-email`} ref={email.ref} type="email" autoComplete="email" value={String(email.value)}
            onChange={email.onChange} onBlur={email.onBlur} disabled={pending} aria-invalid={Boolean(email.error)} />
          {email.error && <p role="alert" className="profile-settings__contact-error">{email.error}</p>}</div>
        <div className="space-y-1.5"><Label htmlFor={`${prefix}-password`}>Current password</Label>
          <PasswordInput id={`${prefix}-password`} ref={password.ref} autoComplete="current-password" value={String(password.value)}
            onChange={password.onChange} onBlur={password.onBlur} disabled={pending} aria-invalid={Boolean(password.error)} />
          {password.error && <p role="alert" className="profile-settings__contact-error">{password.error}</p>}</div>
      </form>
      <UnsavedChangesDialog controller={save} /></>,
    }} />;
}
