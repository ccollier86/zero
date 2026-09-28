/** Deployment-aware admission controls for public authentication requests. */

export type AuthRequestAdmissionFlow =
  | 'bootstrap'
  | 'registration'
  | 'login'
  | 'invitation'
  | 'join-request'
  | 'domain-onboarding';

export interface AuthRequestAdmissionFlowConfig {
  /** Rolling counting window. Supports `s`, `m`, `h`, and `d`. */
  window?: string;
  /** Maximum admitted requests across this app in one window. */
  maxGlobal?: number;
  /** Maximum admitted requests from one resolved source in one window. */
  maxPerSource?: number;
  /** Maximum admitted requests for one hashed email/login identifier. */
  maxPerSubject?: number;
}

export interface ResolvedAuthRequestAdmissionFlowConfig {
  readonly windowMs: number;
  readonly maxGlobal: number;
  readonly maxPerSource: number;
  readonly maxPerSubject: number;
}

export interface AuthRequestSourceContext {
  request: Request;
  flow: AuthRequestAdmissionFlow;
  /** Direct socket peer reported by Bun before forwarded headers are read. */
  peerAddress?: string | null;
}

export type AuthRequestSourceResolver = (
  context: AuthRequestSourceContext,
) => string | null | undefined;

export interface AuthRequestAdmissionConfig {
  /** Disable Zero's built-in admission boundary. Default: true. */
  enabled?: boolean;
  /** Maximum expired rows removed by one admitted request. */
  cleanupBatchSize?: number;
  /** Proxy address/CIDR ranges allowed to supply the forwarded client chain. */
  trustedProxyRanges?: readonly string[];
  /** Forwarded client-chain header. Defaults to `x-forwarded-for`. */
  forwardedForHeader?: string;
  /** Deployment-owned source resolver; mutually exclusive with proxy options. */
  sourceKey?: AuthRequestSourceResolver;
  bootstrap?: AuthRequestAdmissionFlowConfig;
  registration?: AuthRequestAdmissionFlowConfig;
  login?: AuthRequestAdmissionFlowConfig;
  /** Public invitation inspection, sign-in, and acceptance work. */
  invitation?: AuthRequestAdmissionFlowConfig;
  /** Pre-session tenant join-request submission work. */
  joinRequest?: AuthRequestAdmissionFlowConfig;
  /** Generic-before-proof verified-domain mailbox/discovery work. */
  domainOnboarding?: AuthRequestAdmissionFlowConfig;
}

export interface ResolvedAuthRequestAdmissionConfig {
  readonly enabled: boolean;
  readonly cleanupBatchSize: number;
  readonly trustedProxyRanges: readonly string[];
  readonly forwardedForHeader: string;
  readonly sourceKey: AuthRequestSourceResolver;
  readonly flows: Readonly<Record<
    AuthRequestAdmissionFlow,
    ResolvedAuthRequestAdmissionFlowConfig
  >>;
}
