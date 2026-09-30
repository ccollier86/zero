'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard sign-in route. This file composes Zero's reusable auth
 * UI only; authentication transport and route protection stay in the platform.
 */

import { AuthLayout, LoginForm } from '@zero/framework/react';

export const meta = {
  title: 'Sign in | LaunchBoard',
  description: 'Sign in to your LaunchBoard workspace.',
};

/** Render the public sign-in page. */
export default function LoginPage() {
  return (
    <AuthLayout appName="LaunchBoard">
      <LoginForm
        forgotPasswordHref="/forgot-password"
        identifierAutoComplete="email"
        identifierLabel="Email"
        identifierPlaceholder="you@example.com"
        registerHref="/register"
      />
    </AuthLayout>
  );
}
