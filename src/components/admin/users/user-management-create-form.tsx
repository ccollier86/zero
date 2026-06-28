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
  passwordChangeRequired: boolean;
  properties: Record<string, unknown>;
}

/** Render the admin create-user form with optional setup-email behavior. */
export function UserManagementCreateForm({
  config,
  roleOptions,
  onSubmit,
}: UserManagementCreateFormProps) {
  const setupEmailReady = Boolean(config?.capabilities.setupEmail);
  const defaultSendSetupEmail = Boolean(
    setupEmailReady && config?.accountEmails.adminCreatedUser,
  );
  const [state, setState] = React.useState<CreateFormState>({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    role: roleOptions[0]?.value ?? 'user',
    password: '',
    sendSetupEmail: defaultSendSetupEmail,
    passwordChangeRequired: defaultSendSetupEmail,
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
          passwordChangeRequired: state.passwordChangeRequired || state.sendSetupEmail,
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
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-username">Username</Label>
          <Input
            id="zero-admin-create-username"
            value={state.username}
            onChange={(event) => update('username', event.target.value)}
            autoFocus
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
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-first-name">First name</Label>
          <Input
            id="zero-admin-create-first-name"
            value={state.firstName}
            onChange={(event) => update('firstName', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zero-admin-create-last-name">Last name</Label>
          <Input
            id="zero-admin-create-last-name"
            value={state.lastName}
            onChange={(event) => update('lastName', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={state.role} onValueChange={(value) => update('role', value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!state.sendSetupEmail && (
          <div className="space-y-2">
            <Label htmlFor="zero-admin-create-password">Password</Label>
            <Input
              id="zero-admin-create-password"
              type="password"
              value={state.password}
              minLength={8}
              onChange={(event) => update('password', event.target.value)}
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
              onCheckedChange={(checked) => {
                const sendSetupEmail = checked === true;
                setState((current) => ({
                  ...current,
                  sendSetupEmail,
                  passwordChangeRequired: sendSetupEmail || current.passwordChangeRequired,
                }));
              }}
            />
            Send account setup email
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={state.passwordChangeRequired}
            onCheckedChange={(checked) => update('passwordChangeRequired', checked === true)}
          />
          Require password change
        </label>
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          Create user
        </Button>
      </div>
    </form>
  );
}
