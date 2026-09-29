'use client';

/**
 * user-management-create-form.tsx
 *
 * Renders the admin-created user form used by the UserManagement organism.
 * This file owns create-form state and client-side ergonomics only; the
 * backend remains authoritative for validation, defaults, and email readiness.
 */

import * as React from 'react';
import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
} from '../../../frontend/client/auth-client';
import { Button } from '../../ui/button';
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
import type { UserRoleOption } from './user-management-types';
import { UserPropertyControls } from './user-property-controls';
import { toAdminUserCreateParams } from './user-management-mappers';

export interface UserManagementCreateFormProps {
  config: AuthAdminConfig | null;
  roleOptions: readonly UserRoleOption[];
  /** @internal Controlled surfaces may own global-role authority themselves. */
  allowGlobalAdminRole?: boolean;
  onSubmit: (params: AuthAdminCreateUserParams) => Promise<void>;
}

interface CreateFormState {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  password: string;
  sendSetupEmail: boolean;
  mfaRequired: boolean;
  properties: Record<string, unknown>;
}

/** Render the admin create-user form with optional setup-email behavior. */
export function UserManagementCreateForm({
  config,
  roleOptions,
  allowGlobalAdminRole = config?.capabilities.canManageGlobalAdmins === true,
  onSubmit,
}: UserManagementCreateFormProps) {
  const setupEmailReady = Boolean(config?.capabilities.setupEmail);
  const availableRoleOptions = allowGlobalAdminRole
    ? roleOptions
    : roleOptions.filter((option) => option.value !== 'admin');
  const defaultRole = availableRoleOptions.find((option) => option.value === 'user')?.value
    ?? availableRoleOptions[0]?.value
    ?? 'user';
  const multiTenant = config?.tenancy?.mode === 'multi';
  const tenantSingular = config?.tenancy?.terminology?.singular ?? 'organization';
  const defaultSendSetupEmail = Boolean(
    setupEmailReady && config?.accountEmails.adminCreatedUser,
  );
  const [state, setState] = React.useState<CreateFormState>({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    role: defaultRole,
    password: '',
    sendSetupEmail: defaultSendSetupEmail,
    mfaRequired: false,
    properties: {},
  });
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const update = React.useCallback(
    <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => {
      setState((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  React.useEffect(() => {
    if (availableRoleOptions.some((option) => option.value === state.role)) return;
    setState((current) => ({ ...current, role: defaultRole }));
  }, [availableRoleOptions, defaultRole, state.role]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;

      if (!state.username.trim() || !state.email.trim()) {
        setError('Username and email are required.');
        return;
      }
      if (!state.sendSetupEmail && state.password.trim().length < 8) {
        setError('Password must be at least 8 characters when setup email is not used.');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        await onSubmit(toAdminUserCreateParams({
          username: state.username,
          email: state.email,
          firstName: state.firstName,
          lastName: state.lastName,
          role: state.role,
          password: state.password,
          sendSetupEmail: setupEmailReady ? state.sendSetupEmail : false,
          mfaRequired: state.mfaRequired,
          properties: state.properties,
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create user');
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, setupEmailReady, state, submitting],
  );

  return (
    <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-username">Username</Label>
          <Input
            id="zero-admin-create-username"
            value={state.username}
            onChange={(event) => update('username', event.target.value)}
            autoFocus
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-email">Email</Label>
          <Input
            id="zero-admin-create-email"
            type="email"
            value={state.email}
            onChange={(event) => update('email', event.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-first-name">First name</Label>
          <Input
            id="zero-admin-create-first-name"
            value={state.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-last-name">Last name</Label>
          <Input
            id="zero-admin-create-last-name"
            value={state.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            disabled={submitting}
          />
        </div>
        {allowGlobalAdminRole ? (
          <div className="space-y-2">
            <Label htmlFor="zero-admin-create-role">
              {multiTenant ? 'Global identity role' : 'Role'}
            </Label>
            <Select
              value={state.role}
              onValueChange={(value) => update('role', value)}
              disabled={submitting}
            >
              <SelectTrigger id="zero-admin-create-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRoleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {multiTenant && (
              <p className="text-xs text-muted-foreground">
                Global identity roles govern installation-wide account administration. {capitalize(tenantSingular)} access is managed separately.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            This account will use the standard user role. Creating global administrators requires separate authority.
          </p>
        )}
        {!state.sendSetupEmail && (
          <div className="space-y-2">
            <Label htmlFor="zero-admin-create-password">Password</Label>
            <Input
              id="zero-admin-create-password"
              type="password"
              value={state.password}
              minLength={8}
              onChange={(event) => update('password', event.target.value)}
              disabled={submitting}
              required
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {setupEmailReady && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.sendSetupEmail}
              disabled={submitting}
              onCheckedChange={(checked) => update('sendSetupEmail', checked === true)}
            />
            Send account setup email
          </label>
        )}
        {config?.capabilities.mfa && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={state.mfaRequired}
              disabled={submitting}
              onCheckedChange={(checked) => update('mfaRequired', checked === true)}
            />
            Require MFA
          </label>
        )}
      </div>

      <UserPropertyControls
        config={config}
        values={state.properties}
        disabled={submitting}
        onChange={(key, value) => {
          setState((current) => ({
            ...current,
            properties: { ...current.properties, [key]: value },
          }));
        }}
      />

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          Create user
        </Button>
      </div>
    </form>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
