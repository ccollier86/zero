'use client';

import * as React from 'react';

import {
  AuthHeader,
  AuthLayout,
  TenantInvitationForm,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import { Input } from '@zero/framework/components/ui/input';
import { Label } from '@zero/framework/components/ui/label';
import { useAuth, useRouter } from '@zero/framework/react/hooks';

import {
  cleanOnboardingHref,
  clearInvitationRoute,
  hasInvitationRouteMaterial,
  INVITATION_HANDOFF_UPDATED_EVENT,
  isInvitationRouteToken,
  rememberInvitationRoute,
  resolveInvitationRouteEntry,
} from '../../auth-route-query';

export const meta = {
  title: 'Accept invitation | Guardian + Fabric + Torrent Proof',
  description: 'Join a Guardian workspace through its exact invitation flow.',
};

interface InvitationLocation {
  readonly token: string;
  readonly continuation?: string;
}

/** Public landing route for this proof's manually delivered Guardian invitations. */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const auth = useAuth();
  const [location, setLocation] = React.useState<InvitationLocation | null>();
  const capturedLocation = React.useRef<InvitationLocation | null | undefined>(undefined);
  const [manualToken, setManualToken] = React.useState('');
  const [entryError, setEntryError] = React.useState<string | null>(null);
  const flowRegion = React.useRef<HTMLDivElement>(null);
  const tokenInput = React.useRef<HTMLInputElement>(null);
  const tokenId = React.useId();
  const tokenDescriptionId = `${tokenId}-description`;

  React.useEffect(() => {
    if (capturedLocation.current === undefined) {
      const storage = safeSessionStorage();
      const entry = resolveInvitationRouteEntry(
        window.location.hash,
        window.location.search,
        storage,
      );
      capturedLocation.current = entry.input;
      if (entry.source === 'link') {
        notifyHandoffChanged();
        if (entry.malformed) {
          setEntryError(
            'The invitation link is incomplete or malformed. Paste the complete token to continue.',
          );
        }
      }
    }
    if (window.location.search || window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        cleanOnboardingHref(window.location.pathname),
      );
    }
    if (auth.isRestoring) return;
    setLocation(capturedLocation.current);
  }, [auth.isAuthenticated, auth.isRestoring]);

  React.useEffect(() => {
    function captureFragmentInvitation() {
      if (!hasInvitationRouteMaterial(window.location.hash)) return;
      const storage = safeSessionStorage();
      const entry = resolveInvitationRouteEntry(
        window.location.hash,
        window.location.search,
        storage,
      );
      capturedLocation.current = entry.input;
      setManualToken('');
      setEntryError(entry.malformed
        ? 'The invitation link is incomplete or malformed. Paste the complete token to continue.'
        : null);
      setLocation(auth.isRestoring ? undefined : entry.input);
      notifyHandoffChanged();
      window.history.replaceState(
        window.history.state,
        '',
        cleanOnboardingHref(window.location.pathname),
      );
    }

    window.addEventListener('hashchange', captureFragmentInvitation);
    return () => window.removeEventListener('hashchange', captureFragmentInvitation);
  }, [auth.isRestoring]);

  React.useEffect(() => {
    if (location === undefined) return;
    if (location) flowRegion.current?.focus();
    else tokenInput.current?.focus();
  }, [location]);

  return (
    <AuthLayout appName="Guardian + Fabric + Torrent Proof">
      {location === undefined ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Loading invitation…
        </p>
      ) : location ? (
        <div
          ref={flowRegion}
          className="space-y-3 outline-none"
          tabIndex={-1}
          role="region"
          aria-label="Invitation acceptance"
        >
          <TenantInvitationForm
            token={location.token}
            continuation={location.continuation}
            onBeforeSignIn={() => {
              const storage = safeSessionStorage();
              const retained = Boolean(storage && rememberInvitationRoute(storage, location));
              if (!retained) {
                setEntryError(
                  'This browser blocked the temporary current-tab handoff. Sign in first, then return and paste the invitation token again.',
                );
                return false;
              }
              setEntryError(null);
              notifyHandoffChanged();
              return true;
            }}
            onSuccess={() => {
              const storage = safeSessionStorage();
              if (storage) {
                clearInvitationRoute(storage);
                notifyHandoffChanged();
              }
              router.replace('/app');
            }}
          />
          {entryError ? <InvitationHandoffError message={entryError} /> : null}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              const storage = safeSessionStorage();
              if (storage) {
                clearInvitationRoute(storage);
                notifyHandoffChanged();
              }
              capturedLocation.current = null;
              setEntryError(null);
              setLocation(null);
            }}
          >
            Use a different invitation
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const token = manualToken.trim();
            if (!isInvitationRouteToken(token)) {
              setEntryError('Enter the complete invitation token beginning with zinv_.');
              return;
            }
            const next = Object.freeze({ token });
            const storage = safeSessionStorage();
            if (storage) {
              clearInvitationRoute(storage);
              notifyHandoffChanged();
            }
            capturedLocation.current = next;
            setEntryError(null);
            setLocation(next);
            setManualToken('');
          }}
        >
          <AuthHeader
            title="Accept a workspace invitation"
            description="Paste the one-time token shared by your workspace administrator."
          />
          {entryError ? (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3" role="alert">
              <p className="text-sm text-destructive">{entryError}</p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={tokenId}>Invitation token</Label>
            <Input
              ref={tokenInput}
              id={tokenId}
              type="password"
              value={manualToken}
              onChange={(event) => {
                setManualToken(event.target.value);
                setEntryError(null);
              }}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={tokenDescriptionId}
              minLength={45}
              maxLength={200}
              pattern="zinv_[A-Za-z0-9_-]+"
              required
            />
            <p id={tokenDescriptionId} className="text-xs text-muted-foreground">
              The token is removed from the URL. If sign-in is required, it is retained only
              in this browser tab until you return and submit it to Guardian.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={!manualToken.trim()}>
            Continue securely
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function notifyHandoffChanged(): void {
  window.dispatchEvent(new Event(INVITATION_HANDOFF_UPDATED_EVENT));
}

function InvitationHandoffError({ message }: { message: string }) {
  return (
    <div
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3"
      role="alert"
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button asChild size="sm" variant="outline">
        <a href="/login?redirect=%2Faccept-invitation">Sign in first</a>
      </Button>
    </div>
  );
}
