/** Contact possession is distinct from an administrator satisfying a login gate. */
export interface AuthUserContactConfig {
  enabled?: boolean;
  email?: { verify?: boolean; change?: boolean };
  phone?: { enabled?: boolean; editable?: boolean; verify?: boolean };
  verificationPath?: string;
  challengeTTL?: string;
  resendCooldown?: string;
  maxAttempts?: number;
}
export interface ResolvedAuthUserContactConfig {
  enabled: boolean;
  email: { verify: boolean; change: boolean };
  phone: { enabled: boolean; editable: boolean; verify: boolean };
  verificationPath: string;
  challengeTTL: string;
  challengeTTLms: number;
  resendCooldown: string;
  resendCooldownMs: number;
  maxAttempts: number;
}
export type UserContactProofState = 'absent' | 'unverified' | 'pending'
  | 'delivery-unavailable' | 'possession-verified' | 'administratively-attested';
export interface UserContactCapabilities {
  state: 'ready' | 'blocked' | 'disabled';
  email: { readable: boolean; verifyReady: boolean; changeReady: boolean; cancelReady?: boolean };
  phone: { readable: boolean; enabled: boolean; editable: boolean; verifyReady: boolean; cancelReady?: boolean };
  verificationPath: string;
}
export interface UserContactValue {
  value: string | null;
  state: UserContactProofState;
  verifiedAt: number | null;
  /** Pending values are never activated login identifiers. */
  pendingValue: string | null;
  challengeId: string | null;
  expiresAt: number | null;
}
export interface UserContactSnapshot {
  userId: string;
  revision: number;
  email: UserContactValue | null;
  phone: UserContactValue | null;
  capabilities: UserContactCapabilities;
}
export interface EmailContactVerificationResult {
  verified: true;
  /** Identify the completed account so an unrelated signed-in account is never retired. */
  userId: string;
  /** A login-identifier transition retires existing sessions. */
  requiresSignIn: boolean;
}
export interface RequestUserContactVerificationInput { expectedRevision: number }
export interface SetUserPhoneInput extends RequestUserContactVerificationInput { phone: string | null }
export interface ChangeUserEmailInput extends RequestUserContactVerificationInput { email: string; currentPassword: string }
export interface CompleteUserPhoneVerificationInput extends RequestUserContactVerificationInput { challengeId: string; code: string }
export interface CancelUserContactVerificationInput extends RequestUserContactVerificationInput { challengeId: string }
export interface CompleteUserEmailVerificationInput { token: string }
export interface PhoneVerificationRequest {
  challengeId: string;
  phone: string;
  expiresAt: number;
  signal: AbortSignal;
}
/** Trusted server code. Never expose this object or its references to browsers. */
export interface PhoneVerificationAdapter {
  id: string;
  isReady(): boolean;
  /** Must be idempotent by challengeId, including retries after process restart. */
  start(input: PhoneVerificationRequest): Promise<{ reference: string }>;
  verify(input: PhoneVerificationRequest & { reference: string; code: string }): Promise<boolean>;
  cancel?(input: PhoneVerificationRequest & { reference: string }): Promise<void>;
}
