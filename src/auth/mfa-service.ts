/**
 * mfa-service.ts
 *
 * Owns MFA runtime policy helpers for auth config exposure. This service does
 * not persist methods, verify OTP codes, send email, or issue auth tokens.
 */

import type {
  AuthMfaMethodType,
  ResolvedAuthBehaviorConfig,
  ResolvedAuthMfaConfig,
} from './types';

/** Runtime readiness signals required to use configured MFA methods. */
export interface MfaReadinessInput {
  /** True when email OTP can be sent through the configured email provider. */
  emailOtpReady: boolean;
}

/** Public-safe MFA readiness derived from config and runtime state. */
export interface MfaReadiness {
  enabled: boolean;
  ready: boolean;
  methods: AuthMfaMethodType[];
  availableMethods: AuthMfaMethodType[];
  emailOtpReady: boolean;
  totpReady: boolean;
  totpEncryptionConfigured: boolean;
}

/** Public/client-safe MFA config returned from `/auth/config`. */
export interface PublicMfaConfig {
  enabled: boolean;
  policy: ResolvedAuthMfaConfig['policy'];
  methods: AuthMfaMethodType[];
  availableMethods: AuthMfaMethodType[];
  allowUserChoice: boolean;
  allowMultipleMethods: boolean;
  rememberDevice: boolean;
  recoveryCodes: boolean;
  ready: boolean;
}

/** Admin-safe MFA config including operational readiness details. */
export interface AdminMfaConfig extends PublicMfaConfig {
  challengeTTL: string;
  challengeCooldown: string;
  maxAttempts: number;
  totp: {
    issuer?: string;
    qrRobustness: ResolvedAuthMfaConfig['totp']['qrRobustness'];
    encryptionConfigured: boolean;
    ready: boolean;
  };
  emailOtpReady: boolean;
}

/** Framework-neutral MFA policy/readiness helper. */
export class MfaService {
  constructor(private readonly authConfig: ResolvedAuthBehaviorConfig) {}

  /** Return normalized MFA config used by lower-level auth services. */
  get config(): ResolvedAuthMfaConfig {
    return this.authConfig.mfa;
  }

  /**
   * Resolve which configured MFA methods can currently be used.
   *
   * Email OTP readiness depends on runtime email configuration. TOTP readiness
   * depends on a configured encryption secret because Zero stores TOTP seeds
   * encrypted at rest.
   */
  getReadiness(input: MfaReadinessInput): MfaReadiness {
    const config = this.authConfig.mfa;
    const totpEncryptionConfigured = Boolean(config.totp.encryptionKey);
    const totpReady = config.methods.includes('totp') && totpEncryptionConfigured;
    const emailOtpReady = config.methods.includes('email') && input.emailOtpReady;
    const availableMethods = config.methods.filter((method) =>
      method === 'email' ? emailOtpReady : totpReady
    );

    return {
      enabled: config.enabled,
      ready: !config.enabled || availableMethods.length > 0,
      methods: [...config.methods],
      availableMethods,
      emailOtpReady,
      totpReady,
      totpEncryptionConfigured,
    };
  }

  /** Build the public `/auth/config` MFA payload. */
  buildPublicConfig(input: MfaReadinessInput): PublicMfaConfig {
    const config = this.authConfig.mfa;
    const readiness = this.getReadiness(input);

    return {
      enabled: config.enabled,
      policy: config.policy,
      methods: readiness.methods,
      availableMethods: readiness.availableMethods,
      allowUserChoice: config.allowUserChoice,
      allowMultipleMethods: config.allowMultipleMethods,
      rememberDevice: config.rememberDevice,
      recoveryCodes: config.recoveryCodes,
      ready: readiness.ready,
    };
  }

  /** Build the admin `/auth/admin/config` MFA payload. */
  buildAdminConfig(input: MfaReadinessInput): AdminMfaConfig {
    const config = this.authConfig.mfa;
    const readiness = this.getReadiness(input);

    return {
      ...this.buildPublicConfig(input),
      challengeTTL: config.challengeTTL,
      challengeCooldown: config.challengeCooldown,
      maxAttempts: config.maxAttempts,
      totp: {
        issuer: config.totp.issuer,
        qrRobustness: config.totp.qrRobustness,
        encryptionConfigured: readiness.totpEncryptionConfigured,
        ready: readiness.totpReady,
      },
      emailOtpReady: readiness.emailOtpReady,
    };
  }
}
