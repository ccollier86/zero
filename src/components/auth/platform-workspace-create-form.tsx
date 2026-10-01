'use client';

/** Focused modal form for creating one customer workspace. */

import * as React from 'react';
import type {
  AuthPlatformTenantCreateParams,
} from '../../frontend/client/auth-platform-administration-types';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { getAuthDisplayMessage } from './auth-error';

export interface PlatformWorkspaceCreateFormProps {
  singular: string;
  onSubmit: (params: AuthPlatformTenantCreateParams) => Promise<void>;
}

/** Collect the small amount of data required by the platform create contract. */
export function PlatformWorkspaceCreateForm({
  singular,
  onSubmit,
}: PlatformWorkspaceCreateFormProps) {
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [ownerEmail, setOwnerEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const nameId = `${id}-name`;
  const slugId = `${id}-slug`;
  const ownerEmailId = `${id}-owner-email`;
  const ownerEmailHelpId = `${id}-owner-email-help`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const workspaceName = name.trim();
    const email = ownerEmail.trim();
    if (!workspaceName || !email) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: workspaceName,
        ownerEmail: email,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
      });
    } catch (cause) {
      setError(getAuthDisplayMessage(cause, `Failed to create ${singular}`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={nameId}>{capitalize(singular)} name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="organization"
            autoFocus
            maxLength={120}
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={slugId}>URL name (optional)</Label>
          <Input
            id={slugId}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="acme-health"
            pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
            maxLength={63}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ownerEmailId}>Initial owner email</Label>
          <Input
            id={ownerEmailId}
            type="email"
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
            autoComplete="email"
            aria-describedby={ownerEmailHelpId}
            disabled={submitting}
            required
          />
        </div>
      </div>

      <p id={ownerEmailHelpId} className="text-xs text-muted-foreground">
        Choose an existing active account. Account creation remains in People management.
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !ownerEmail.trim()}
        >
          {submitting ? 'Creating…' : `Create ${singular}`}
        </Button>
      </div>
    </form>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
