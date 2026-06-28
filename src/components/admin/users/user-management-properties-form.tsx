'use client';

/**
 * user-management-properties-form.tsx
 *
 * Renders the configured user-property editor below the admin user detail
 * form. This file owns property edit state only; API mutation is delegated to
 * the parent user-management organism.
 */

import * as React from 'react';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { Button } from '../../ui/button';
import type { UserManagementUser } from './user-management-types';
import {
  getAdminEditablePropertyFields,
  parseUserPropertyValues,
  UserPropertyControls,
} from './user-property-controls';

export interface UserManagementPropertiesFormProps {
  user: UserManagementUser;
  config: AuthAdminConfig | null;
  onSubmit: (properties: Record<string, unknown>) => Promise<void>;
}

/** Render configured user KV fields for the selected admin user. */
export function UserManagementPropertiesForm({
  user,
  config,
  onSubmit,
}: UserManagementPropertiesFormProps) {
  const fields = getAdminEditablePropertyFields(config);
  const [values, setValues] = React.useState<Record<string, unknown>>(
    () => parseUserPropertyValues(config, user.properties),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const propertySnapshot = React.useMemo(
    () => JSON.stringify(user.properties),
    [user.properties],
  );

  React.useEffect(() => {
    setValues(parseUserPropertyValues(config, user.properties));
    setError(null);
  }, [config, propertySnapshot, user.id]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;

      setSubmitting(true);
      setError(null);
      try {
        await onSubmit(values);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save properties');
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, submitting, values],
  );

  if (fields.length === 0) return null;

  return (
    <form className="mt-6 space-y-4 border-t border-border pt-4" onSubmit={handleSubmit}>
      <h3 className="text-sm font-medium">Properties</h3>
      <UserPropertyControls
        config={config}
        values={values}
        disabled={submitting}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={submitting}>
        Save properties
      </Button>
    </form>
  );
}
