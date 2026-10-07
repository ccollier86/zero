'use client';

/** Regional controls compose existing Zero selectors over global-user values. */
import { useId } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Combobox } from '../ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { UseFormReturn } from '../../hooks/use-form';
import type { UserProfileCapabilities } from '../../auth/auth-user-profile-types';
import type { ProfileSettingsDraft } from './profile-draft';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LANGUAGES = [ ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt-BR', 'Português (Brasil)'],
  ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文（简体）'], ['ar', 'العربية'] ];

export interface UserRegionalSettingsProps {
  form: UseFormReturn<ProfileSettingsDraft>;
  capabilities: UserProfileCapabilities;
  readOnly?: boolean;
  pending?: boolean;
}
export function UserRegionalSettings({ form, capabilities, readOnly, pending }: UserRegionalSettingsProps) {
  const prefix = useId(), regional = capabilities.regional;
  if (!regional.enabled) return null;
  const locked = readOnly || !regional.editable || capabilities.state !== 'ready';
  const timeZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
  const options = {
    locale: [{ value: 'inherit', label: 'Application default' }, ...LANGUAGES.map(([value, label]) => ({ value: value!, label: label! }))],
    timeZone: [{ value: 'inherit', label: 'Application default' }, { value: 'UTC', label: 'UTC' },
      ...timeZones.filter(zone => zone !== 'UTC').map(zone => ({ value: zone, label: zone.replaceAll('_', ' ') }))],
    timeFormat: [{ value: 'inherit', label: 'Application default' }, { value: '12h', label: '12-hour · 3:30 PM' }, { value: '24h', label: '24-hour · 15:30' }],
    weekStartsOn: [{ value: 'inherit', label: 'Application default' }, ...DAYS.map((label, index) => ({ value: String(index), label }))],
  };
  const labels = { locale: 'Language', timeZone: 'Time zone', timeFormat: 'Time format', weekStartsOn: 'Week starts on' };
  return <section className="profile-settings__section" aria-label="Regional preferences">
    <header className="profile-settings__section-header"><h3>Regional preferences</h3>
      <p>Used across your workspaces. Leave a value on the application default to inherit its settings.</p></header>
    <div className="profile-settings__fields">
      {regional.fields.map(key => {
        const value = form.watch(key), id = `${prefix}-${key}`, choices = options[key];
        const display = choices.find(option => option.value === String(value))?.label ?? (value == null ? 'Application default' : String(value));
        const defaultValue = regional.defaults[key];
        const defaultLabel = choices.find(option => option.value === String(defaultValue))?.label ?? String(defaultValue);
        return <div className="profile-settings__field" key={key}>
          <Label className="profile-settings__label" htmlFor={id}>{labels[key]}</Label>
          <div className="min-w-0 space-y-1.5">
            {locked ? <Input id={id} value={display} readOnly className="profile-settings__input" />
              : key === 'timeZone' || key === 'locale' ? <Combobox id={id} aria-label={labels[key]}
                  value={value == null ? 'inherit' : String(value)} disabled={pending}
                  options={choices.some(option => option.value === String(value)) || value == null ? choices : [...choices, { value: String(value), label: String(value) }]}
                  onChange={next => form.setValue(key, next === 'inherit' || next === '' ? null : next)} />
              : <Select value={value == null ? 'inherit' : String(value)} disabled={pending}
                onValueChange={next => form.setValue(key, next === 'inherit' ? null : key === 'weekStartsOn' ? Number(next) : next)}>
                <SelectTrigger id={id} className="profile-settings__input"><SelectValue /></SelectTrigger>
                <SelectContent>{choices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>}
            {value == null && defaultValue != null && <p className="profile-settings__hint">Current default: {defaultLabel}</p>}
          </div>
        </div>;
      })}
    </div>
  </section>;
}
