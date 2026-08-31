import type { AuthEmailOutboxTerminal } from './auth-email-outbox-types';
import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { RegistrationIntentStore } from './registration-intent-store';
import type { NativeAuthorizationService } from './oidc/native-authorization-service';
import type { ResolvedAuthBehaviorConfig } from './types';
import type { UserStore } from './user-store';

export interface AuthEmailOutboxDeliveryDeps {
  store: UserStore;
  tokens: AuthActionTokenService;
  email: AccountEmailService;
  registrationIntents: RegistrationIntentStore;
  config: ResolvedAuthBehaviorConfig;
  getNative: () => NativeAuthorizationService | null;
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
