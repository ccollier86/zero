'use client';

/**
 * password-action-page.tsx
 *
 * Shared LaunchBoard reset/setup password page shell. This file owns reading
 * browser query tokens only; token validation and password mutation stay in
 * Zero auth.
 */

import * as React from 'react';
import { AuthLayout, PasswordActionForm } from '@zero/framework/react';

interface PasswordActionPageProps {
  mode: 'reset' | 'setup';
}

/** Render a reset/setup password form from a query token or manual paste. */
export function PasswordActionPage({ mode }: PasswordActionPageProps) {
  const [token, setToken] = React.useState('');

  React.useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setToken(params.get('token') ?? params.get('code') ?? '');
  }, []);

  return (
    <AuthLayout appName="LaunchBoard">
      <PasswordActionForm token={token} mode={mode} loginHref="/login" />
    </AuthLayout>
  );
}
