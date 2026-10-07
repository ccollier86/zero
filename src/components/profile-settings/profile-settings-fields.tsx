'use client';

/** Compact identity controls; draft/persistence remain in the shared form/controller. */
import { useId } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import type { UseFormReturn } from '../../hooks/use-form';
import type { UserProfileCapabilities, UserProfileField, UserSocialLink } from '../../auth/auth-user-profile-types';
import type { ProfileSettingsDraft } from './profile-draft';

const LABELS: Record<UserProfileField, string> = {
  firstName: 'First name', lastName: 'Last name', username: 'Username',
  preferredName: 'Preferred name', bio: 'About you', website: 'Website', socialLinks: 'Social profiles',
};
export interface UserProfileFieldsProps {
  form: UseFormReturn<ProfileSettingsDraft>;
  capabilities: UserProfileCapabilities;
  readOnly?: boolean;
  pending?: boolean;
  fieldActions?: boolean;
  /** A revision conflict requires an explicit review instead of another stale write. */
  saveBlocked?: boolean;
  saveField?(field: UserProfileField): Promise<void>;
  discardField?(field: UserProfileField): void;
}
export function UserProfileFields({ form, capabilities, readOnly, pending, fieldActions, saveBlocked, saveField, discardField }: UserProfileFieldsProps) {
  const prefix = useId();
  return <div className="profile-settings__fields">
    {(Object.keys(LABELS) as UserProfileField[]).filter(key => capabilities.fields[key].enabled).map(key => {
      const policy = capabilities.fields[key], id = `${prefix}-${key}`;
      const locked = readOnly || !policy.editable || capabilities.state !== 'ready';
      const dirty = form.dirtyFields.includes(key), registration = form.register(key);
      return <div className="profile-settings__field" key={key}>
        <Label htmlFor={key === 'socialLinks' ? undefined : id} className="profile-settings__label">
          {LABELS[key]}{policy.required && <span aria-label="required" className="text-muted-foreground"> *</span>}
        </Label>
        <div className="min-w-0 space-y-1.5">
          <div className="profile-settings__control">
            {key === 'socialLinks' ? <SocialProfiles value={(form.watch(key) ?? []) as UserSocialLink[]}
              readOnly={locked} disabled={pending} onChange={value => form.setValue(key, value)} />
              : key === 'bio' ? <Textarea id={id} value={String(form.watch(key) ?? '')} readOnly={locked}
                ref={registration.ref}
                disabled={pending} rows={3} maxLength={2000} className="profile-settings__input"
                onChange={registration.onChange} onBlur={registration.onBlur} aria-invalid={Boolean(registration.error)} />
              : <Input id={id} value={String(form.watch(key) ?? '')} readOnly={locked} disabled={pending}
                ref={registration.ref}
                autoComplete={key === 'firstName' ? 'given-name' : key === 'lastName' ? 'family-name' : key === 'username' ? 'username' : 'off'}
                type={key === 'website' ? 'url' : 'text'} className="profile-settings__input"
                onChange={registration.onChange} onBlur={registration.onBlur} aria-invalid={Boolean(registration.error)} />}
            {fieldActions && dirty && !locked && <div className="profile-settings__field-actions">
              <Button type="button" size="icon" variant="ghost" className="size-7 text-success"
                aria-label={`Save ${LABELS[key]}`} disabled={pending || saveBlocked} onClick={() => { void saveField?.(key); }}><Check /></Button>
              <Button type="button" size="icon" variant="ghost" className="size-7 text-destructive"
                aria-label={`Cancel ${LABELS[key]} changes`} disabled={pending} onClick={() => discardField?.(key)}><X /></Button>
            </div>}
          </div>
          {registration.error && <p role="alert" className="text-xs text-destructive">{registration.error}</p>}
          {key === 'preferredName' && <p className="profile-settings__hint">The name you prefer people to use.</p>}
          {locked && !readOnly && <p className="profile-settings__hint">Managed by your organization or application.</p>}
        </div>
      </div>;
    })}
  </div>;
}

function SocialProfiles({ value, readOnly, disabled, onChange }: {
  value: UserSocialLink[]; readOnly?: boolean; disabled?: boolean; onChange(value: UserSocialLink[]): void;
}) {
  return <div className="w-full space-y-2" aria-label="Social profiles">
    {value.map((link, index) => <div key={index} className="profile-settings__social">
      <Input aria-label={`Social profile ${index + 1} label`} placeholder="Profile name" value={link.label}
        readOnly={readOnly} disabled={disabled} maxLength={80} className="profile-settings__input"
        onChange={event => onChange(value.map((old, i) => i === index ? { ...old, label: event.target.value } : old))} />
      <Input aria-label={`Social profile ${index + 1} URL`} placeholder="https://" type="url" value={link.url}
        readOnly={readOnly} disabled={disabled} maxLength={2048} className="profile-settings__input"
        onChange={event => onChange(value.map((old, i) => i === index ? { ...old, url: event.target.value } : old))} />
      {!readOnly && <Button type="button" variant="ghost" size="icon" aria-label={`Remove social profile ${index + 1}`}
        disabled={disabled} className="size-8" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 /></Button>}
    </div>)}
    {readOnly && value.length === 0 && <p className="profile-settings__hint">No social profiles added.</p>}
    {!readOnly && <Button type="button" variant="ghost" size="sm" disabled={disabled || value.length >= 12}
      onClick={() => onChange([...value, { label: '', url: '' }])}><Plus />Add a social profile</Button>}
  </div>;
}
