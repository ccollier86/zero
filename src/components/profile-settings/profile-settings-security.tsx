'use client';

/** Compact security entry points reuse Guardian's password/MFA components. */
import { useId, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '../ui/button';
import { ControlledModal } from '../../modals/modal-controlled';
import { ChangePasswordForm } from '../auth/change-password-form';
import { MFAManagementPanel } from '../auth/mfa-management-panel';

export function UserProfileSecurity({ readOnly = false }: { readOnly?: boolean }) {
  const [changingPassword, setChangingPassword] = useState(false);
  const prefix = useId(), trigger = useRef<HTMLButtonElement | null>(null), formId = `change-password-${prefix}`;
  if (readOnly) return null;
  return <section className="profile-settings__section" aria-label="Account security">
    <header className="profile-settings__section-header"><h3>Account security</h3>
      <p>Manage how you sign in and protect your account.</p></header>
    <div className="profile-settings__security-row"><div><span className="font-medium">Password</span>
      <p className="profile-settings__hint">Use a unique password you don’t use elsewhere.</p></div>
      <Button ref={trigger} type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}><KeyRound />Change password</Button>
    </div>
    <MFAManagementPanel className="profile-settings__mfa" />
    <ControlledModal<void> open={changingPassword} onOpenChange={setChangingPassword} descriptor={{
      title: 'Change your password', description: 'Update the password for the signed-in account.', icon: <KeyRound />, size: 'sm', trigger: trigger.current,
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel', variant: 'ghost' },
        { id: 'save', label: 'Change password', variant: 'primary', submit: true, formId,
          // The existing native form owns validation and acknowledgment. If it
          // cannot handle a submit, the shell must not manufacture acceptance.
          onClick: () => false }],
      body: context => <ChangePasswordForm modalContext={context} formId={formId} />,
    }} />
  </section>;
}
