'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard password-reset completion route. This file composes
 * Zero's action-token form only; backend auth validates and consumes tokens.
 */

import { PasswordActionPage } from '../auth/password-action-page';

export const meta = {
  title: 'Reset password | LaunchBoard',
  description: 'Choose a new LaunchBoard password.',
};

/** Render the public password-reset completion page. */
export default function ResetPasswordPage() {
  return <PasswordActionPage mode="reset" />;
}
