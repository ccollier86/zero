'use client';

/** Focused modal form for creating one customer workspace. */

import * as React from 'react';
import type {
  AuthPlatformTenantCreateParams, AuthPlatformTenantCreateResult,
} from '../../frontend/client/auth-platform-administration-types';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import type { ModalContext } from '../../modals/modal-system.types';
import { bindModalFormState } from '../../modals/modal-form';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

export interface PlatformWorkspaceCreateFormProps {
  singular: string;
  onSubmit: (params: AuthPlatformTenantCreateParams) => Promise<void | AuthPlatformTenantCreateResult>;
  modalContext?: ModalContext<AuthPlatformTenantCreateResult>;
  formId?: string;
  showSubmit?: boolean;
}

/** Collect the small amount of data required by the platform create contract. */
export function PlatformWorkspaceCreateForm({
  singular,
  onSubmit,
  modalContext, formId, showSubmit = true,
}: PlatformWorkspaceCreateFormProps) {
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [ownerEmail, setOwnerEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef(false), mounted = React.useRef(true);
  const binding = React.useRef<ReturnType<typeof bindModalFormState> | null>(null);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    if (!modalContext) return;
    const owned = bindModalFormState(modalContext); binding.current = owned;
    return () => { owned.dispose(); if (binding.current === owned) binding.current = null; };
  }, [modalContext]);
  React.useEffect(() => { binding.current?.update({ dirty: Boolean(name || slug || ownerEmail), busy: submitting, error }); },
    [error, name, ownerEmail, slug, submitting, modalContext]);
  const id = React.useId();
  const nameId = `${id}-name`;
  const slugId = `${id}-slug`;
  const ownerEmailId = `${id}-owner-email`;
  const ownerEmailHelpId = `${id}-owner-email-help`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending.current || modalContext?.signal.aborted || !mounted.current) return;

    const workspaceName = name.trim();
    const email = ownerEmail.trim();
    if (!workspaceName || !email) return;

    pending.current = true; modalContext?.setBusy(true); setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit({
        name: workspaceName,
        ownerEmail: email,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
      });
      if (mounted.current && !modalContext?.signal.aborted && modalContext) {
        if (result === undefined) throw new Error('Missing workspace creation acknowledgment.');
        modalContext.accept(result);
      }
    } catch {
      if (mounted.current && !modalContext?.signal.aborted) {
        emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'workspace-create', stage: 'submit' } });
        setError(`The ${singular} could not be created. Please try again.`);
      }
    } finally {
      pending.current = false;
      if (mounted.current && !modalContext?.signal.aborted) { modalContext?.setBusy(false); setSubmitting(false); }
    }
  }

  return (
    <form id={formId} className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
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

      {error && !modalContext && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {showSubmit && <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !ownerEmail.trim()}
        >
          {submitting ? 'Creating…' : `Create ${singular}`}
        </Button>
      </div>}
    </form>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
