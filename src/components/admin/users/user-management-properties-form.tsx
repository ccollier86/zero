'use client';

/**
 * user-management-properties-form.tsx
 *
 * Renders the configured user-property editor below the admin user detail
 * form. This file owns property edit state only; API mutation is delegated to
 * the parent user-management organism.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import type { UserManagementUser } from './user-management-types';
import {
  buildPropertyMutationPlan,
  canEditCustomUserProperties,
  createCustomPropertyRows,
  type UserManagementCustomPropertyRow,
} from './user-management-property-editor';
import {
  getAdminEditablePropertyFields,
  parseUserPropertyValues,
  UserPropertyControls,
} from './user-property-controls';

export interface UserManagementPropertiesFormProps {
  user: UserManagementUser;
  config: AuthAdminConfig | null;
  onSubmit: (properties: Record<string, unknown>) => Promise<void>;
  onDeleteProperty?: (key: string) => Promise<void>;
}

/** Render configured user KV fields for the selected admin user. */
export function UserManagementPropertiesForm({
  user,
  config,
  onSubmit,
  onDeleteProperty,
}: UserManagementPropertiesFormProps) {
  const fields = getAdminEditablePropertyFields(config);
  const [values, setValues] = React.useState<Record<string, unknown>>(
    () => parseUserPropertyValues(config, user.properties),
  );
  const [customRows, setCustomRows] = React.useState<UserManagementCustomPropertyRow[]>(
    () => createCustomPropertyRows(config, user.properties),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const allowCustomProperties = canEditCustomUserProperties(config);
  const propertySnapshot = React.useMemo(
    () => JSON.stringify(user.properties),
    [user.properties],
  );

  React.useEffect(() => {
    setValues(parseUserPropertyValues(config, user.properties));
    setCustomRows(createCustomPropertyRows(config, user.properties));
    setError(null);
  }, [config, propertySnapshot, user.id]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;

      setSubmitting(true);
      setError(null);
      try {
        const plan = buildPropertyMutationPlan({
          config,
          originalProperties: user.properties,
          configuredValues: values,
          customRows: allowCustomProperties ? customRows : [],
        });

        if (plan.deleteKeys.length > 0 && !onDeleteProperty) {
          throw new Error('Deleting custom properties requires an onDeleteProperty handler.');
        }

        await onSubmit(plan.properties);
        if (onDeleteProperty) {
          for (const key of plan.deleteKeys) {
            await onDeleteProperty(key);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save properties');
      } finally {
        setSubmitting(false);
      }
    },
    [allowCustomProperties, config, customRows, onDeleteProperty, onSubmit, submitting, user.properties, values],
  );

  if (fields.length === 0 && !allowCustomProperties) return null;

  return (
    <form
      className="mt-4 space-y-3 border-t border-border pt-3"
      onSubmit={handleSubmit}
      aria-busy={submitting}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Properties</h3>
        <Button type="submit" size="sm" disabled={submitting}>
          Save properties
        </Button>
      </div>

      {fields.length > 0 && (
        <UserPropertyControls
          config={config}
          values={values}
          disabled={submitting}
          compact
          onChange={(key, value) => {
            setValues((current) => ({ ...current, [key]: value }));
          }}
        />
      )}

      {allowCustomProperties && (
        <CustomPropertiesEditor
          rows={customRows}
          disabled={submitting}
          onChange={setCustomRows}
        />
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </form>
  );
}

function CustomPropertiesEditor({
  rows,
  disabled,
  onChange,
}: {
  rows: UserManagementCustomPropertyRow[];
  disabled: boolean;
  onChange: React.Dispatch<React.SetStateAction<UserManagementCustomPropertyRow[]>>;
}) {
  const addRow = React.useCallback(() => {
    onChange((current) => [
      ...current,
      { id: `new:${crypto.randomUUID()}`, key: '', value: '' },
    ]);
  }, [onChange]);

  const updateRow = React.useCallback(
    (id: string, changes: Partial<Pick<UserManagementCustomPropertyRow, 'key' | 'value'>>) => {
      onChange((current) => current.map((row) => row.id === id ? { ...row, ...changes } : row));
    },
    [onChange],
  );

  const removeRow = React.useCallback(
    (id: string) => {
      onChange((current) => current.filter((row) => row.id !== id));
    },
    [onChange],
  );

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Additional properties
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Store app-specific user metadata as key/value pairs.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addRow}>
          <Plus className="size-4" />
          Add property
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No additional properties.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]">
              <div className="space-y-1">
                <Label className="sr-only" htmlFor={`${row.id}:key`}>Property key</Label>
                <Input
                  id={`${row.id}:key`}
                  value={row.key}
                  disabled={disabled}
                  placeholder="key"
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="sr-only" htmlFor={`${row.id}:value`}>Property value</Label>
                <Input
                  id={`${row.id}:value`}
                  value={row.value}
                  disabled={disabled}
                  placeholder="value"
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() => removeRow(row.id)}
                aria-label={`Remove ${row.key || 'property'}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
