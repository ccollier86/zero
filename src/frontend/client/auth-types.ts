/** Public contracts shared by the browser auth client and focused transports. */

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number | null;
}

export interface RegisterParams {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Optional MFA enrollment request when app MFA policy is optional. */
  mfaEnrollment?: boolean;
  /** Validated local continuation for a pending native registration. */
  nativeContinuation?: string;
}

export type AuthMfaMethodType = 'email' | 'totp';

export interface AuthMfaMethod {
  methodId: string;
  type: AuthMfaMethodType;
  label: string | null;
  status: 'pending' | 'active' | 'disabled';
  isPrimary: boolean;
  createdAt: number;
  verifiedAt: number | null;
  lastUsedAt: number | null;
}

export interface AuthMfaChallenge {
  challengeId: string;
  methodType: AuthMfaMethodType;
  expiresAt: number;
  delivery: 'email' | 'authenticator';
}

export interface AuthMfaSetupRequiredResult {
  user: AuthUser;
  mfaSetupRequired: true;
  mfaSetupToken: string;
  mfa: {
    methods: AuthMfaMethodType[];
    allowUserChoice: boolean;
  };
}

export interface AuthMfaChallengeRequiredResult {
  user: AuthUser;
  mfaChallengeRequired: true;
  mfaChallenge: {
    method: AuthMfaMethod;
    challenge?: AuthMfaChallenge;
    challengeToken: string;
  };
}

export interface AuthSessionResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  mfaSetupRequired?: false;
  mfaChallengeRequired?: false;
}

/** Password recovery/setup completed; a fresh login must start a new session. */
export interface AuthPasswordUpdatedResult {
  user: AuthUser;
  passwordUpdated: true;
  signInRequired: true;
}

export type AuthCompletionResult =
  | AuthSessionResult
  | AuthMfaSetupRequiredResult
  | AuthMfaChallengeRequiredResult
  | AuthPasswordUpdatedResult;

export interface AuthMfaSetupStartResult {
  setupRequired: boolean;
  method: AuthMfaMethod;
  challenge?: AuthMfaChallenge;
  totp?: {
    secret: string;
    otpauthUrl: string;
    issuer: string;
    accountName: string;
  };
  verificationToken: string;
}

export type AuthMfaSetupVerifyResult =
  | AuthSessionResult
  | {
      ok: true;
      method: AuthMfaMethod;
      methods: AuthMfaMethod[];
    };

export interface AuthUserPropertyConfig {
  key: string;
  type: 'string' | 'enum' | 'boolean' | 'number';
  label?: string;
  values?: string[];
  default?: string;
  editableBy: 'user' | 'admin' | 'system' | 'none';
  useInPolicies?: boolean;
  description?: string;
}

export interface AuthPublicConfig {
  registration: {
    mode: 'public' | 'admin-only' | 'disabled';
    bootstrapRequired: boolean;
    publicRegistrationEnabled: boolean;
    userCount?: number;
  };
  accountEmails?: {
    adminCreatedUser: boolean;
    passwordReset: boolean;
    passwordChangedNotice: boolean;
    emailVerification?: boolean;
  };
  account?: {
    requireEmailVerification: boolean;
    emailVerificationPath: string;
    emailVerificationReady: boolean;
  };
  mfa?: {
    enabled: boolean;
    policy: 'optional' | 'required' | 'admin-required';
    methods: Array<'email' | 'totp'>;
    availableMethods: Array<'email' | 'totp'>;
    allowUserChoice: boolean;
    allowMultipleMethods: boolean;
    rememberDevice: boolean;
    recoveryCodes: boolean;
    ready: boolean;
  };
  userProperties?: Record<string, AuthUserPropertyConfig>;
  strictUserProperties?: boolean;
}

export interface AuthActionTokenInfo {
  valid: boolean;
  type: 'account_setup' | 'password_reset' | 'admin_password_reset' | 'email_verification';
  expiresAt: number;
  user: {
    userId: string;
    username: string;
    email: string;
  };
}

export function isAuthSessionResult(value: unknown): value is AuthSessionResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSessionResult>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    Boolean(candidate.user)
  );
}
