'use client';

/**
 * page.tsx
 *
 * Public LaunchBoard account-setup completion route. This file composes
 * Zero's action-token form only; backend auth validates and consumes tokens.
 */

import { PasswordActionPage } from '../auth/password-action-page';

export const meta = {
  title: 'Set password | LaunchBoard',
  description: 'Set your LaunchBoard account password.',
};

/** Render the public account-setup password page. */
export default function SetupPasswordPage() {
  return <PasswordActionPage mode="setup" />;
}
