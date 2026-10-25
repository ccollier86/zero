/** Server-only checkpoint ports. Credentials/signing keys never enter a realm, actor or browser contract. */
import type { LoggingCheckpoint } from './logging-evidence-contracts';
import type { LoggingStream } from './logging-contracts';

export interface SignedLoggingCheckpoint extends LoggingCheckpoint {
  readonly ledgerId: string;
  readonly issuedAt: number;
  readonly keyId: string;
  readonly previousDigest: string | null;
  readonly signature: string;
}

/** Retains immutable versions and implements compare-and-append atomically. Independence is a deployment property. */
export interface LoggingCustodyStore {
  readonly identity: string;
  read(ledgerId: string, stream: LoggingStream, signal: AbortSignal): Promise<SignedLoggingCheckpoint | null>;
  append(checkpoint: SignedLoggingCheckpoint, expectedDigest: string | null, signal: AbortSignal): Promise<SignedLoggingCheckpoint>;
}

export interface LoggingCheckpointSigner {
  readonly keyId: string;
  /** Retain previous public keys through the entire checkpoint/backup retention horizon. */
  readonly publicKeys: Readonly<Record<string, string>>;
  sign(canonicalPayload: string, signal: AbortSignal): Promise<string>;
}

export interface LoggingCustodyConfig {
  /** Stable deployment identity, declared outside mutable evidence storage. Never a patient identifier. */
  readonly ledgerId: string;
  readonly store: LoggingCustodyStore;
  readonly signer: LoggingCheckpointSigner;
  /** Explicit, one-time trust decision for adopting an existing unsigned preview trail. Default false. */
  readonly adoptExisting?: boolean;
  /** Bounds the initial adoption scan; increasing it is explicit, not an unbounded startup task. */
  readonly maxAdoptionProofs?: number;
  /** Full startup verification is paginated and fails closed above this explicit proof budget. */
  readonly maxVerificationProofs?: number;
}

/** Self-contained checkpoint ledger in its own private Fabric database. No external account is required. */
export interface LocalLoggingCustodyConfig {
  readonly kind: 'local';
  /** Explicit one-time adoption of an existing unsigned trail; never repairs changed signed evidence. */
  readonly adoptExisting?: boolean;
  readonly maxAdoptionProofs?: number;
  readonly maxVerificationProofs?: number;
  /** Change this stable operator-chosen ID to rotate the private key, retaining all earlier public keys. */
  readonly keyId?: string;
}
