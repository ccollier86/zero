'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard password-reset request route. This file renders Zero's
 * packaged form only; email delivery and token issuance stay in platform auth.
 */

import { AuthLayout, ForgotPasswordForm } from '@zero/framework/react';

export const meta = {
  title: 'Reset password | LaunchBoard',
  description: 'Request a LaunchBoard password reset email.',
};

/** Render the public password reset request page. */
export default function ForgotPasswordPage() {
  return (
    <AuthLayout appName="LaunchBoard">
      <ForgotPasswordForm loginHref="/login" />
    </AuthLayout>
  );
}
