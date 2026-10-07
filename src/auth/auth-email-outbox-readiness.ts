import type { AccountEmailService } from './account-email-service';
import type { ResolvedAuthBehaviorConfig } from './types';

export function shouldStartAuthEmailOutbox(
  config: ResolvedAuthBehaviorConfig,
  email: AccountEmailService
): boolean {
  if (!config.accountEmails.passwordReset
    && !config.account.requireEmailVerification
    && !config.tenancy?.onboarding?.invitations.delivery.email.enabled
    && !config.tenancy?.onboarding?.verifiedDomains.enabled
    && !(config.userProfile?.enabled && config.userProfile.contacts.enabled
      && (config.userProfile.contacts.email.verify || config.userProfile.contacts.email.change))) return false;
  try {
    email.assertReady();
    return true;
  } catch {
    return false;
  }
}
