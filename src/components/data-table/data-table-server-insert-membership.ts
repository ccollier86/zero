/**
 * Coordinates bounded, authoritative off-page INSERT membership for the table
 * source layer. It consumes only a supplied read callback and live change IDs;
 * it never evaluates query criteria, merges rows, or owns transport/auth policy.
 */
import type { DataTableServerChange } from './data-table-server-types';

const MAX_TRACKED_IDS = 1_000;
const MAX_BATCH_IDS = 50;
const MAX_ROW_ID_LENGTH = 1_024;

/** Criteria/source/authority identity excludes page position; callbacks may change without retiring evidence. */
export interface DataTableServerInsertMembershipConfiguration {
  key: string;
  confirm: ((rowIds: readonly string[], signal: AbortSignal) => Promise<readonly string[]>) | null;
  isCurrent: () => boolean;
  onChange: () => void;
  onError: (cause: unknown) => void;
}

interface Receipt {
  epoch: number;
  state: 'pending' | 'active' | 'confirmed' | 'settled';
}

interface ConfirmationBatch {
  revision: number;
  controller: AbortController;
  receipts: readonly { rowId: string; epoch: number }[];
}

/** Confirms genuine INSERT identities once, fencing source retirement and later UPDATE/DELETE receipts. */
export class DataTableServerInsertMembership {
  private configuration: DataTableServerInsertMembershipConfiguration | null = null;
  private readonly receipts = new Map<string, Receipt>();
  private receiptEpoch = 0;
  private revision = 0;
  private active: ConfirmationBatch | null = null;
  private scheduledRevision: number | null = null;
  private confirmed: readonly string[] = Object.freeze([]);

  /** Replace callback references; only a different key or unsupported/current-false scope retires evidence. */
  configure(configuration: DataTableServerInsertMembershipConfiguration): void {
    const changed = this.configuration?.key !== configuration.key;
    this.configuration = configuration;
    if (changed || configuration.confirm === null) this.clear();
    if (!this.ensureCurrent()) return;
    this.schedule();
  }

  /** Stage only unseen genuine INSERTs; later tracked UPDATEs revalidate and DELETEs remove immediately. */
  observe(change: DataTableServerChange, baselineIds: readonly string[]): void {
    if (!validChange(change) || !this.configuration?.confirm || !this.ensureCurrent()) return;
    const previous = this.receipts.get(change.rowId);

    if (change.op === 'DELETE') {
      if (this.receipts.delete(change.rowId)) this.publish();
      return;
    }
    if (change.op === 'UPDATE') {
      if (!previous || previous.state === 'settled') return;
      this.receipts.set(change.rowId, { epoch: ++this.receiptEpoch, state: 'pending' });
      this.publish();
      this.schedule();
      return;
    }
    if (previous || baselineIds.includes(change.rowId)) return;
    const alreadyInBatch = this.active?.receipts.some(receipt => receipt.rowId === change.rowId);
    if (!alreadyInBatch && this.trackedIdCount() >= MAX_TRACKED_IDS) return;
    this.receipts.set(change.rowId, { epoch: ++this.receiptEpoch, state: 'pending' });
    this.schedule();
  }

  /** Reveal/source retirement discards pending and confirmed evidence, even if transport ignores abort. */
  clear(): void {
    this.revision += 1;
    this.scheduledRevision = null;
    const active = this.active;
    this.active = null;
    this.receipts.clear();
    active?.controller.abort();
    if (this.confirmed.length === 0) return;
    this.confirmed = Object.freeze([]);
    this.configuration?.onChange();
  }

  /** Return a stable immutable identity snapshot until confirmed membership actually changes. */
  confirmedIds(): readonly string[] {
    return this.confirmed;
  }

  /** Disposal uses the same complete retirement boundary as reveal. */
  cancel(): void {
    this.clear();
  }

  private ensureCurrent(): boolean {
    if (this.configuration?.isCurrent()) return true;
    this.clear();
    return false;
  }

  private schedule(): void {
    if (this.active || this.scheduledRevision !== null || !this.configuration?.confirm
      || ![...this.receipts.values()].some(receipt => receipt.state === 'pending')) return;
    const revision = this.revision;
    this.scheduledRevision = revision;
    queueMicrotask(() => {
      if (this.scheduledRevision !== revision) return;
      this.scheduledRevision = null;
      if (this.revision === revision) void this.confirmPending();
    });
  }

  private async confirmPending(): Promise<void> {
    if (this.active || !this.configuration?.confirm || !this.ensureCurrent()) return;
    const confirm = this.configuration.confirm;
    const receipts: { rowId: string; epoch: number }[] = [];
    for (const [rowId, receipt] of this.receipts) {
      if (receipt.state !== 'pending') continue;
      receipt.state = 'active';
      receipts.push({ rowId, epoch: receipt.epoch });
      if (receipts.length === MAX_BATCH_IDS) break;
    }
    if (receipts.length === 0) return;
    const batch: ConfirmationBatch = { revision: this.revision, controller: new AbortController(), receipts };
    this.active = batch;
    let matchingIds: readonly string[];
    try {
      if (!this.isActive(batch) || !this.ensureCurrent()) return;
      matchingIds = await confirm(Object.freeze(receipts.map(receipt => receipt.rowId)), batch.controller.signal);
      if (!validConfirmationIds(matchingIds, receipts.length)) {
        throw new TypeError('Invalid server insert membership response.');
      }
    } catch (cause) {
      if (!this.isActive(batch) || !this.ensureCurrent()) return;
      this.active = null;
      this.settle(batch, []);
      // Failure is terminal for these receipt epochs, not a retry trigger.
      if (this.ensureCurrent()) this.configuration?.onError(cause);
      this.schedule();
      return;
    }
    if (!this.isActive(batch) || !this.ensureCurrent()) return;
    this.active = null;
    this.settle(batch, matchingIds);
    this.publish();
    this.schedule();
  }

  private isActive(batch: ConfirmationBatch): boolean {
    return this.active === batch && batch.revision === this.revision && !batch.controller.signal.aborted;
  }

  private trackedIdCount(): number {
    let count = this.receipts.size;
    // DELETE removes visible evidence immediately, but an active reply still retains that identity.
    for (const receipt of this.active?.receipts ?? []) {
      if (!this.receipts.has(receipt.rowId)) count += 1;
    }
    return count;
  }

  private settle(batch: ConfirmationBatch, matchingIds: readonly string[]): void {
    for (const { rowId, epoch } of batch.receipts) {
      const receipt = this.receipts.get(rowId);
      if (receipt?.epoch !== epoch || receipt.state !== 'active') continue;
      // Only requested identities may be admitted; adapter extras are never evidence.
      receipt.state = matchingIds.includes(rowId) ? 'confirmed' : 'settled';
    }
  }

  private publish(): void {
    if (!this.ensureCurrent()) return;
    const next = [...this.receipts].filter(([, receipt]) => receipt.state === 'confirmed').map(([rowId]) => rowId);
    if (next.length === this.confirmed.length && next.every((rowId, index) => rowId === this.confirmed[index])) return;
    this.confirmed = Object.freeze(next);
    this.configuration?.onChange();
  }
}

function validChange(change: DataTableServerChange): boolean {
  return !!change && (change.op === 'INSERT' || change.op === 'UPDATE' || change.op === 'DELETE')
    && typeof change.rowId === 'string' && change.rowId.length > 0 && change.rowId.length <= MAX_ROW_ID_LENGTH;
}

function validConfirmationIds(value: unknown, maximum: number): value is readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) return false;
  for (let index = 0; index < value.length; index += 1) {
    const rowId = value[index];
    if (typeof rowId !== 'string' || rowId.length === 0 || rowId.length > MAX_ROW_ID_LENGTH) return false;
  }
  return true;
}
