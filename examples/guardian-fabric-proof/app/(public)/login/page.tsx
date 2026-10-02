'use client';

import { AuthLayout, LoginForm } from '@zero/framework/components/auth';

export const meta = {
  title: 'Sign in | Guardian + Fabric + Torrent Proof',
  description: 'Sign in to a Guardian-backed workspace session.',
};

/** Public Guardian login route; AppProvider owns the safe post-login return. */
export default function LoginPage() {
  return (
    <AuthLayout appName="Guardian + Fabric + Torrent Proof">
      <LoginForm
        identifierAutoComplete="email"
        identifierLabel="Email"
        identifierPlaceholder="you@example.com"
        registerHref="/register"
        showForgotPassword={false}
      />
    </AuthLayout>
  );
}
