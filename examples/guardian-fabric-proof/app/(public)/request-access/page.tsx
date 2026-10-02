'use client';

import * as React from 'react';

import {
  AuthHeader,
  AuthLayout,
  TenantJoinRequestForm,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import { Input } from '@zero/framework/components/ui/input';
import { Label } from '@zero/framework/components/ui/label';

import {
  cleanOnboardingHref,
  isWorkspaceSlug,
  normalizeWorkspaceSlug,
  parseWorkspaceSlug,
} from '../../auth-route-query';

export const meta = {
  title: 'Request workspace access | Guardian + Fabric + Torrent Proof',
  description: 'Submit a retained, non-enumerating Guardian workspace join request.',
};

/** Public sign-in-aware entry to Guardian's retained join-request flow. */
export default function RequestAccessPage() {
  const [workspaceSlug, setWorkspaceSlug] = React.useState('');
  const [targetSlug, setTargetSlug] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const requestStep = React.useRef<HTMLDivElement>(null);
  const slugId = React.useId();
  const descriptionId = `${slugId}-description`;

  React.useEffect(() => {
    const initial = parseWorkspaceSlug(window.location.search);
    setWorkspaceSlug(initial);
    setTargetSlug(initial);
    const cleanHref = cleanOnboardingHref(
      window.location.pathname,
      window.location.hash,
      initial,
    );
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== cleanHref) {
      window.history.replaceState(window.history.state, '', cleanHref);
    }
  }, []);

  React.useEffect(() => {
    if (targetSlug) requestStep.current?.focus();
  }, [targetSlug]);

  function chooseWorkspace(event: React.FormEvent) {
    event.preventDefault();
    const nextSlug = normalizeWorkspaceSlug(workspaceSlug);
    if (!isWorkspaceSlug(nextSlug)) return;
    setWorkspaceSlug(nextSlug);
    setTargetSlug(nextSlug);
    setSubmitted(false);
    window.history.replaceState(
      window.history.state,
      '',
      cleanOnboardingHref(window.location.pathname, window.location.hash, nextSlug),
    );
  }

  return (
    <AuthLayout appName="Guardian + Fabric + Torrent Proof">
      <div className="space-y-6">
        <form className="space-y-4" onSubmit={chooseWorkspace}>
          <AuthHeader
            title="Request workspace access"
            description="Enter the exact workspace slug shared by its administrator. The response never reveals whether another workspace exists."
          />
          <div className="space-y-1.5">
            <Label htmlFor={slugId}>Workspace slug</Label>
            <Input
              id={slugId}
              value={workspaceSlug}
              onChange={(event) => {
                setWorkspaceSlug(normalizeWorkspaceSlug(event.target.value));
                if (targetSlug) {
                  setTargetSlug('');
                  window.history.replaceState(
                    window.history.state,
                    '',
                    cleanOnboardingHref(window.location.pathname, window.location.hash),
                  );
                }
                setSubmitted(false);
              }}
              placeholder="example-workspace"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={63}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              aria-describedby={descriptionId}
              required
            />
            <p id={descriptionId} className="text-xs text-muted-foreground">
              Use lowercase letters, numbers, and single hyphens.
            </p>
          </div>
          <Button type="submit" variant="outline" className="w-full" disabled={!workspaceSlug.trim()}>
            Continue
          </Button>
        </form>

        {targetSlug ? (
          <div
            ref={requestStep}
            className="space-y-4 border-t border-border pt-6 outline-none"
            tabIndex={-1}
          >
            <p className="sr-only" role="status" aria-live="polite">
              Workspace selected. Continue with the access request.
            </p>
            <TenantJoinRequestForm
              tenantSlug={targetSlug}
              onSubmitted={() => setSubmitted(true)}
            />
            {submitted ? (
              <Button asChild variant="outline" className="w-full">
                <a href="/app">Return to the app</a>
              </Button>
            ) : null}
          </div>
        ) : (
          <Button asChild variant="ghost" className="w-full">
            <a href="/">Back to the proof overview</a>
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
