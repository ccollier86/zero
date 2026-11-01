'use client';

/**
 * user-properties-form.tsx
 *
 * Renders current-user editable auth property controls from public auth config.
 * Rendering consumes the scoped draft/submission hook; property validation and
 * authority remain in the native backend writer and Guardian services.
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
import { AuthConfigLoadState } from './auth-config-load-state';
import { useUserPropertiesForm } from './use-user-properties-form';
import type { PropertyFormValue } from './user-properties-draft';

export interface UserPropertiesFormProps {
  title?: string;
  description?: string;
  emptyState?: React.ReactNode;
  /** Current-scope notification after submitted changes are acknowledged; not a commit/rollback hook. */
  onSuccess?: (properties: Record<string, string>) => void;
  /** Default true. Unchanged submissions never issue writes, even when this is false. */
  disableSaveWhenUnchanged?: boolean;
  className?: string;
}

/** Render configured current-user property controls. */
export function UserPropertiesForm({
  title = 'Account settings',
  description = 'Update the settings this app lets you control',
  emptyState = null,
  onSuccess,
  disableSaveWhenUnchanged = true,
  className,
}: UserPropertiesFormProps) {
  const { user } = useAuth();
  const authConfig = useAuthConfig();
  const { config } = authConfig;
  const fields = React.useMemo(
    () => Object.values(config?.userProperties ?? {}).filter(field => field.editableBy === 'user'),
    [config],
  );
  const form = useUserPropertiesForm(fields, onSuccess, authConfig.status === 'ready');
  const { submitting } = form;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void form.submit();
  }

  if (!user) return null;
  if (!form.authorizationReady) return <p role="status" className={cn('text-sm text-muted-foreground', className)}>Loading account settings…</p>;
  if (!config) {
    return (
      <AuthConfigLoadState
        state={authConfig}
        loadingMessage="Loading account settings…"
        unavailableMessage="Account settings could not be loaded."
        className={className}
      />
    );
  }
  if (fields.length === 0) return <>{emptyState}</>;

  return (
    <form data-slot="user-properties-form" onSubmit={handleSubmit} className={cn('space-y-4', className)} aria-busy={submitting}>
      <AuthHeader title={title} description={description} />
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <PropertyField
            key={field.key}
            field={field}
            value={form.value(field.key)}
            disabled={!form.ready}
            onChange={(value) => form.edit(field.key, value)}
          />
        ))}
      </div>
      <Feedback error={form.error} success={form.success} />
      {form.uncertain && (
        <Button type="button" variant="outline" size="sm" disabled={submitting || !form.ready} onClick={() => { void form.reconcile(); }}>
          Check saved settings
        </Button>
      )}
      <Button type="submit" size="sm" disabled={submitting || !form.ready || form.uncertain || (disableSaveWhenUnchanged && !form.dirty)}>
        {submitting ? (
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">{form.reconciling ? 'Checking saved settings' : 'Saving settings'}</span>
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
  value: PropertyFormValue | undefined;
  disabled: boolean;
  onChange: (value: PropertyFormValue) => void;
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
  value: PropertyFormValue | undefined;
  disabled: boolean;
  onChange: (value: PropertyFormValue) => void;
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

function formatPropertyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
