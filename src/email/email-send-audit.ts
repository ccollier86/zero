/** Content-free provider boundary. Accepted means provider acceptance, never recipient delivery or reading. */
export interface EmailSendAuditSpan {
  admit(): Promise<void>;
  finish(outcome: 'accepted' | 'rejected' | 'unknown', counts?: { acceptedCount: number; rejectedCount: number }): Promise<void>;
}
export interface EmailSendAudit { prepare(providerId: string): EmailSendAuditSpan | undefined }
