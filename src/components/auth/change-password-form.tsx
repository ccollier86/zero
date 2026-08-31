'use client';

/**
 * change-password-form.tsx
 *
 * Renders a reusable current-user password change form. This file owns
 * browser form state only; current-password verification and token rotation
 * remain in the auth backend and SDK.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../frontend/client/auth-hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AuthHeader } from '@/components/auth/auth-header';
import { PasswordInput } from '@/components/auth/password-input';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleCheck } from '@/components/animate-ui/icons/circle-check';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';

export interface ChangePasswordFormProps {
  onSuccess?: () => void;
  className?: string;
}

/** Render a current-user password change form. */
export function ChangePasswordForm({ onSuccess, className }: ChangePasswordFormProps) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      reportAuthUiError('changePassword', err);
      setError(getAuthDisplayMessage(err, 'Failed to change password'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-3', className)}>
      <AuthHeader title="Change password" description="Update the password for the signed-in account" />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="change-password-current" className="text-sm font-medium">Current password</Label>
          <PasswordInput
            id="change-password-current"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="change-password-new" className="text-sm font-medium">New password</Label>
          <PasswordInput
            id="change-password-new"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            showStrength
            required
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="change-password-confirm" className="text-sm font-medium">Confirm password</Label>
          <PasswordInput
            id="change-password-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            className="h-8 text-sm"
          />
        </div>
      </div>

      <FormFeedback error={error} success={success ? 'Password changed.' : null} />

      <Button type="submit" size="sm" className="h-8 w-full" disabled={submitting}>
        {submitting ? (
          <AnimateIcon animate loop>
            <Loader size={16} />
          </AnimateIcon>
        ) : (
          'Change password'
        )}
      </Button>
    </form>
  );
}

function FormFeedback({ error, success }: { error: string | null; success: string | null }) {
  const message = error ?? success;
  if (!message) return null;
  const destructive = Boolean(error);

  return (
    <AnimatePresence>
      <motion.div
        initial={authFeedbackInitial}
        animate={authFeedbackAnimate}
        exit={authFeedbackExit}
        transition={authPresenceTransition}
        className="overflow-hidden"
      >
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2.5',
            destructive
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-green-500/30 bg-green-500/5 text-green-600',
          )}
          role={destructive ? 'alert' : 'status'}
        >
          <AnimateIcon animate>
            {destructive ? <CircleX size={16} /> : <CircleCheck size={16} />}
          </AnimateIcon>
          <p className="text-xs font-medium leading-relaxed">{message}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
