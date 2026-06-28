'use client';

/**
 * user-management-password-reset-form.tsx
 *
 * Renders the manual admin password reset form for the UserManagement organism.
 * This file owns password form state only; reset authorization and password
 * policy are enforced by the admin auth route.
 */

import * as React from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

export interface UserManagementPasswordResetFormProps {
  username: string;
  onSubmit: (password: string) => Promise<void>;
}

/** Render the manual password reset form for one admin-selected user. */
export function UserManagementPasswordResetForm({
  username,
  onSubmit,
}: UserManagementPasswordResetFormProps) {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        await onSubmit(password);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reset password');
      } finally {
        setSubmitting(false);
      }
    },
    [confirm, onSubmit, password, submitting],
  );

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm text-muted-foreground">
        Set a new password for {username}.
      </p>
      <div className="space-y-2">
        <Label htmlFor="zero-admin-reset-password">New password</Label>
        <Input
          id="zero-admin-reset-password"
          type="password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="zero-admin-reset-confirm">Confirm password</Label>
        <Input
          id="zero-admin-reset-confirm"
          type="password"
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          Set password
        </Button>
      </div>
    </form>
  );
}
