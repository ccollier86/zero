'use client';

/**
 * user-property-controls.tsx
 *
 * Renders configured auth user property controls for admin forms. This file
 * owns property field UI only; validation remains server-side in
 * UserPropertyService and persistence stays behind the admin SDK.
 */

import * as React from 'react';
import type {
  AuthAdminConfig,
  AuthAdminUserPropertyConfig,
} from '../../../frontend/client/auth-client';
import { Checkbox } from '../../animate-ui/components/radix/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';

export interface UserPropertyControlsProps {
  config: AuthAdminConfig | null;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

/** Render controls for admin-editable configured user property fields. */
export function UserPropertyControls({
  config,
  values,
  onChange,
  disabled = false,
}: UserPropertyControlsProps) {
  const fields = getAdminEditablePropertyFields(config);
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <UserPropertyControl
          key={field.key}
          field={field}
          value={values[field.key] ?? field.default ?? defaultPropertyValue(field)}
          disabled={disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </div>
  );
}

/** Return configured fields that admins may mutate through platform routes. */
export function getAdminEditablePropertyFields(
  config: AuthAdminConfig | null,
): AuthAdminUserPropertyConfig[] {
  return Object.values(config?.userProperties ?? {})
    .filter((field) => field.editableBy === 'admin' || field.editableBy === 'user');
}

/** Parse serialized user property strings into UI control values. */
export function parseUserPropertyValues(
  config: AuthAdminConfig | null,
  properties: Record<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of getAdminEditablePropertyFields(config)) {
    const raw = properties[field.key] ?? field.default;
    if (raw === undefined) continue;
    values[field.key] = parseUserPropertyValue(field, raw);
  }
  return values;
}

function UserPropertyControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: AuthAdminUserPropertyConfig;
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
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}

function renderPropertyInput(params: {
  id: string;
  field: AuthAdminUserPropertyConfig;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { id, field, value, disabled, onChange } = params;

  if (field.type === 'enum' && field.values?.length) {
    return (
      <Select
        value={String(value ?? '')}
        disabled={disabled}
        onValueChange={(next) => onChange(next)}
      >
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
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? '' : Number(next));
        }}
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

function parseUserPropertyValue(
  field: AuthAdminUserPropertyConfig,
  value: string,
): unknown {
  if (field.type === 'boolean') return value === 'true';
  if (field.type === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  }
  return value;
}

function defaultPropertyValue(field: AuthAdminUserPropertyConfig): unknown {
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return '';
  return '';
}

function formatPropertyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
