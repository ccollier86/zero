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
import type { ModalContext } from '../../../modals/modal-system.types';
import { useAdminModalFormState, reportAdminModalFailure } from './use-admin-modal-form-state';

export interface UserManagementPasswordResetFormProps {
  username: string;
  onSubmit: (password: string) => Promise<void>;
  modalContext?: ModalContext<void>;
  formId?: string;
  showSubmit?: boolean;
}

/** Render the manual password reset form for one admin-selected user. */
export function UserManagementPasswordResetForm({
  username,
  onSubmit,
  modalContext, formId, showSubmit = true,
}: UserManagementPasswordResetFormProps) {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useAdminModalFormState(modalContext, { dirty: password !== '' || confirm !== '', busy: submitting, error });

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (submittingRef.current || modalContext?.signal.aborted) return;
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }

      submittingRef.current = true;
      setSubmitting(true); modalContext?.setBusy(true);
      setError(null);
      try {
        await onSubmit(password);
        if (mounted.current && !modalContext?.signal.aborted) modalContext?.accept(undefined);
      } catch {
        if (mounted.current && !modalContext?.signal.aborted) setError(reportAdminModalFailure('set-password'));
      } finally {
        submittingRef.current = false;
        if (mounted.current && !modalContext?.signal.aborted) { setSubmitting(false); modalContext?.setBusy(false); }
      }
    },
    [confirm, onSubmit, password, modalContext],
  );

  return (
    <form id={formId} className="space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
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
      {!modalContext && error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {showSubmit && <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          Set password
        </Button>
      </div>}
    </form>
  );
}
