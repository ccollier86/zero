import type { AuthEmailOutboxTerminal } from './auth-email-outbox-types';
import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';
import type { AuthTenantInvitationEnvelope } from './auth-tenant-invitation-envelope';
import type { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import type { VerifiedDomainOnboardingService } from './verified-domain-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthUserContactService } from './auth-user-contact-service';

export interface AuthEmailOutboxDeliveryDeps {
  store: UserStore;
  tokens: AuthActionTokenService;
  email: AccountEmailService;
  registrationIntents: RegistrationIntentStore;
  config: ResolvedAuthBehaviorConfig;
  getNative: () => NativeAuthorizationService | null;
  invitationEnvelope?: AuthTenantInvitationEnvelope | null;
  getTenantOnboarding?: () => AuthTenantOnboardingService | null;
  getVerifiedDomainOnboarding?: () => VerifiedDomainOnboardingService | null;
  getUserContactService?: () => AuthUserContactService | null;
  emitCode?: AuthPlatformCodeEmitter;
}

export interface AuthEmailDeliveryOutcome {
  status: Exclude<AuthEmailOutboxTerminal, 'dead'>;
  userId?: string;
  reason?: string;
}

export class AuthEmailDeliveryFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly userId: string | undefined,
    public readonly cleanupSucceeded: boolean
  ) {
    super('Auth email outbox delivery failed');
    this.name = 'AuthEmailDeliveryFailure';
  }
}
