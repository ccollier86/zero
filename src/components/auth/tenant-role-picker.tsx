'use client';

import * as React from 'react';
import { Checkbox } from '#zero/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';

export interface TenantRolePickerRole {
  key: string;
  label: string;
  description?: string;
}

export interface TenantRolePickerProps {
  roles: readonly TenantRolePickerRole[];
  selected: readonly string[];
  simple: boolean;
  disabled?: boolean;
  maxSelected?: number;
  legend: string;
  selectLabel: string;
  selectPlaceholder?: string;
  actionContext: string;
  onChange(roles: string[]): void;
}

/** Shared simple/advanced role selector for tenant admission controls. */
export function TenantRolePicker({
  roles,
  selected,
  simple,
  disabled = false,
  maxSelected,
  legend,
  selectLabel,
  selectPlaceholder = 'Choose role',
  actionContext,
  onChange,
}: TenantRolePickerProps) {
  const limitDescriptionId = React.useId();
  if (simple) {
    return (
      <Select
        value={selected[0] ?? ''}
        onValueChange={(value) => onChange([value])}
        disabled={disabled}
      >
        <SelectTrigger aria-label={selectLabel}>
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {roles.map((role) => (
            <SelectItem key={role.key} value={role.key}>
              {role.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const selectedCount = new Set(selected).size;
  const selectionLimitReached =
    maxSelected !== undefined && selectedCount >= maxSelected;

  return (
    <fieldset
      className="grid gap-2 rounded-md border border-border/80 p-3 sm:grid-cols-2"
      aria-describedby={
        maxSelected !== undefined ? limitDescriptionId : undefined
      }
    >
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {legend}
      </legend>
      {maxSelected !== undefined && (
        <p
          id={limitDescriptionId}
          className="text-xs text-muted-foreground sm:col-span-2"
        >
          Choose up to {maxSelected} {maxSelected === 1 ? 'role' : 'roles'}.
        </p>
      )}
      {roles.map((role) => {
        const checked = selected.includes(role.key);
        const roleDisabled = disabled || (!checked && selectionLimitReached);
        return (
          <label key={role.key} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={checked}
              disabled={roleDisabled}
              onCheckedChange={(value) => {
                if (value && !checked && selectionLimitReached) return;
                onChange(
                  value
                    ? [...new Set([...selected, role.key])]
                    : selected.filter((item) => item !== role.key),
                );
              }}
              aria-label={`${checked ? 'Remove' : 'Grant'} ${role.label} ${actionContext}`}
            />
            <span>
              <span className="block font-medium">{role.label}</span>
              {role.description && (
                <span className="block text-xs text-muted-foreground">
                  {role.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
