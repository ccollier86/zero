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
import { useRouter } from '@zero/framework/react/hooks';

export const meta = {
  title: 'Accept invitation | Guardian + Fabric Proof',
  description: 'Join a Guardian workspace through its exact invitation flow.',
};

interface InvitationLocation {
  readonly token: string;
  readonly continuation?: string;
}

/** Public landing route for manual and email-delivered Guardian invitations. */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const [location, setLocation] = React.useState<InvitationLocation | null>();
  const [manualToken, setManualToken] = React.useState('');
  const tokenId = React.useId();
  const tokenDescriptionId = `${tokenId}-description`;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token')?.trim() ?? '';
    const continuation = params.get('continuation') ?? undefined;
    setLocation(token
      ? Object.freeze({ token, ...(continuation ? { continuation } : {}) })
      : null);
  }, []);

  return (
    <AuthLayout appName="Guardian + Fabric Proof">
      {location === undefined ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Loading invitation…
        </p>
      ) : location ? (
        <TenantInvitationForm
          token={location.token}
          continuation={location.continuation}
          onSuccess={() => router.replace('/app')}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const token = manualToken.trim();
            if (token) {
              setLocation(Object.freeze({ token }));
              setManualToken('');
            }
          }}
        >
          <AuthHeader
            title="Accept a workspace invitation"
            description="Paste the one-time token shared by your workspace administrator."
          />
          <div className="space-y-1.5">
            <Label htmlFor={tokenId}>Invitation token</Label>
            <Input
              id={tokenId}
              type="password"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={tokenDescriptionId}
              required
            />
            <p id={tokenDescriptionId} className="text-xs text-muted-foreground">
              The token stays in this page's memory and is submitted only to Guardian.
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
