'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard email-verification route. This file composes Zero's
 * verification form only; backend auth validates and consumes tokens.
 */

import * as React from 'react';
import { AuthLayout, EmailVerificationForm, useRouter } from '@zero/framework/react';

import { getSafeAuthRedirect } from '../auth/redirect';

export const meta = {
  title: 'Verify email | LaunchBoard',
  description: 'Verify your LaunchBoard account email.',
};

/** Render the public email verification page from a query token or manual paste. */
export default function VerifyEmailPage() {
  const router = useRouter();
  const [token, setToken] = React.useState('');

  React.useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setToken(params.get('token') ?? params.get('code') ?? '');
  }, []);

  return (
    <AuthLayout appName="LaunchBoard">
      <EmailVerificationForm
        token={token}
        loginHref="/login"
        onSuccess={() => router.replace(getSafeAuthRedirect('/'))}
      />
    </AuthLayout>
  );
}
