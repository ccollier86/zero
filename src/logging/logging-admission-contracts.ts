/** Browser-safe delivery acknowledgment, not a credential or browser integrity attestation. */
export interface LoggingAdmissionReceipt {
  readonly policyVersion: string;
  readonly expiresAt: number;
}
