'use client';

/**
 * user-properties-form.tsx
 *
 * Renders current-user editable auth property controls from public auth config.
 * This file owns current-user property form state only; property validation and
 * authority are enforced by UserPropertyService on the backend.
 */

import * as React from 'react';
import type { AuthUserPropertyConfig } from '../../frontend/client/auth-client';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';

export interface UserPropertiesFormProps {
  title?: string;
  description?: string;
  emptyState?: React.ReactNode;
  onSuccess?: (properties: Record<string, string>) => void;
  className?: string;
}

/** Render configured current-user property controls. */
export function UserPropertiesForm({
  title = 'Account settings',
  description = 'Update the settings this app lets you control',
  emptyState = null,
  onSuccess,
  className,
}: UserPropertiesFormProps) {
  const { user, setProperty, getProperties } = useAuth();
  const { config } = useAuthConfig();
  const fields = React.useMemo(
    () => Object.values(config?.userProperties ?? {}),
    [config],
  );
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const propertySnapshot = React.useMemo(
    () => JSON.stringify(user?.properties ?? {}),
    [user?.properties],
  );

  React.useEffect(() => {
    setValues(parseInitialPropertyValues(fields, user?.properties ?? {}));
    setError(null);
    setSuccess(false);
  }, [fields, propertySnapshot, user?.userId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      for (const field of fields) {
        await setProperty(field.key, values[field.key] ?? defaultPropertyValue(field));
      }
      const properties = await getProperties();
      setSuccess(true);
      onSuccess?.(properties);
    } catch (err) {
      reportAuthUiError('setUserProperties', err);
      setError(getAuthDisplayMessage(err, 'Failed to update settings'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;
  if (fields.length === 0) return <>{emptyState}</>;

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)} aria-busy={submitting}>
      <AuthHeader title={title} description={description} />
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <PropertyField
            key={field.key}
            field={field}
            value={values[field.key] ?? defaultPropertyValue(field)}
            disabled={submitting}
            onChange={(value) => {
              setValues((current) => ({ ...current, [field.key]: value }));
            }}
          />
        ))}
      </div>
      <Feedback error={error} success={success ? 'Settings updated.' : null} />
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? (
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">Saving settings</span>
          </>
        ) : (
          'Save settings'
        )}
      </Button>
    </form>
  );
}

function PropertyField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: AuthUserPropertyConfig;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = React.useId();
  const label = field.label ?? formatPropertyLabel(field.key);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {renderPropertyInput({ id, field, value, disabled, onChange })}
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  );
}

function renderPropertyInput(params: {
  id: string;
  field: AuthUserPropertyConfig;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { id, field, value, disabled, onChange } = params;
  if (field.type === 'enum' && field.values?.length) {
    return (
      <Select value={String(value ?? '')} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {field.values.map((option) => (
            <SelectItem key={option} value={option}>
              {formatPropertyLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex h-9 items-center">
        <Checkbox
          id={id}
          checked={value === true || value === 'true'}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <Input
        id={id}
        type="number"
        disabled={disabled}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    );
  }

  return (
    <Input
      id={id}
      disabled={disabled}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Feedback({ error, success }: { error: string | null; success: string | null }) {
  const message = error ?? success;
  if (!message) return null;
  const destructive = Boolean(error);

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2.5',
        destructive
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-success/35 bg-success/10 text-foreground dark:border-success/45 dark:bg-success/15',
      )}
      role={destructive ? 'alert' : 'status'}
    >
      <AnimateIcon animate>
        {destructive
          ? <CircleX size={16} />
          : <CircleCheck size={16} className="text-success" />}
      </AnimateIcon>
      <p className="text-xs font-medium leading-relaxed">{message}</p>
    </div>
  );
}

function parseInitialPropertyValues(
  fields: AuthUserPropertyConfig[],
  properties: Record<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = properties[field.key] ?? field.default;
    values[field.key] = raw === undefined
      ? defaultPropertyValue(field)
      : parsePropertyValue(field, raw);
  }
  return values;
}

function parsePropertyValue(field: AuthUserPropertyConfig, value: string): unknown {
  if (field.type === 'boolean') return value === 'true';
  if (field.type === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  }
  return value;
}

function defaultPropertyValue(field: AuthUserPropertyConfig): unknown {
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return '';
  return '';
}

function formatPropertyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
