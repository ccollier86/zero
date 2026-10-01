'use client';

import * as React from 'react';

import {
  clearInvitationRoute,
  invitationHandoffRemainingMs,
  INVITATION_HANDOFF_UPDATED_EVENT,
} from '../auth-route-query';

/** Physically clears an expired current-tab invitation handoff across auth routes. */
export function InvitationHandoffExpiry() {
  React.useEffect(() => {
    let timeout: number | undefined;

    function armExpiry() {
      if (timeout !== undefined) window.clearTimeout(timeout);
      const storage = safeSessionStorage();
      if (!storage) return;
      const remaining = invitationHandoffRemainingMs(storage);
      if (remaining === null) return;
      timeout = window.setTimeout(() => clearInvitationRoute(storage), remaining + 1);
    }

    armExpiry();
    window.addEventListener(INVITATION_HANDOFF_UPDATED_EVENT, armExpiry);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      window.removeEventListener(INVITATION_HANDOFF_UPDATED_EVENT, armExpiry);
    };
  }, []);

  return null;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
