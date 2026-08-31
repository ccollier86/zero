'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard registration route. This page uses Zero's auth-aware
 * RegisterForm so first-user admin bootstrap remains backend-owned.
 */

import { AuthLayout, RegisterForm, useRouter } from '@zero/framework/react';

import { getSafeAuthRedirect } from '../auth/redirect';

export const meta = {
  title: 'Create account | LaunchBoard',
  description: 'Create a LaunchBoard workspace account.',
};

/** Render the public registration page. */
export default function RegisterPage() {
  const router = useRouter();

  return (
    <AuthLayout appName="LaunchBoard">
      <RegisterForm
        fields={['email', 'firstName', 'lastName', 'password']}
        loginHref="/login"
        onSuccess={() => router.replace(getSafeAuthRedirect('/'))}
      />
    </AuthLayout>
  );
}
