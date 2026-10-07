'use client';

/** Compact security entry points reuse Guardian's password/MFA components. */
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../animate-ui/components/radix/dialog';
import { ChangePasswordForm } from '../auth/change-password-form';
import { MFAManagementPanel } from '../auth/mfa-management-panel';

export function UserProfileSecurity({ readOnly = false }: { readOnly?: boolean }) {
  const [changingPassword, setChangingPassword] = useState(false);
  if (readOnly) return null;
  return <section className="profile-settings__section" aria-label="Account security">
    <header className="profile-settings__section-header"><h3>Account security</h3>
      <p>Manage how you sign in and protect your account.</p></header>
    <div className="profile-settings__security-row"><div><span className="font-medium">Password</span>
      <p className="profile-settings__hint">Use a unique password you don’t use elsewhere.</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}><KeyRound />Change password</Button>
    </div>
    <MFAManagementPanel className="profile-settings__mfa" />
    <Dialog open={changingPassword} onOpenChange={setChangingPassword}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle className="sr-only">Change your password</DialogTitle>
        <ChangePasswordForm onSuccess={() => setChangingPassword(false)} />
      </DialogContent>
    </Dialog>
  </section>;
}
