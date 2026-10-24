export type PaymentsJobStatus = 'pending' | 'processing' | 'retry' | 'quarantined' | 'complete';
export interface PaymentsJob {
  id: string; kind: 'webhook' | 'reconcile' | 'notify'; status: PaymentsJobStatus;
  attempts: number; dueAt: string; error: string | null;
}
export interface PaymentsJobQuery { status?: PaymentsJobStatus; limit?: number; after?: string }
export interface PaymentsJobPage { items: PaymentsJob[]; next?: string }
