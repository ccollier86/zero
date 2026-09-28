import type { AccountEmailService } from './account-email-service';
import type { ResolvedAuthBehaviorConfig } from './types';

export function shouldStartAuthEmailOutbox(
  config: ResolvedAuthBehaviorConfig,
  email: AccountEmailService
): boolean {
  if (!config.accountEmails.passwordReset
    && !config.account.requireEmailVerification
    && !config.tenancy?.onboarding?.invitations.delivery.email.enabled
    && !config.tenancy?.onboarding?.verifiedDomains.enabled) return false;
  try {
    email.assertReady();
    return true;
  } catch {
    return false;
  }
}
