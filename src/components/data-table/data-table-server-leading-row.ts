/**
 * Owns bounded, query-authorized first-row evidence for live-arrival navigation.
 * This coordinator consumes one injected identity lookup, coalesces changes and
 * fences cancelled/retired proofs; it does not infer ranking, merge rows, fetch
 * data, or control pagination.
 */

export interface DataTableServerLeadingRowConfiguration {
  key: string;
  read: ((signal: AbortSignal) => Promise<string | null>) | null;
  isCurrent: () => boolean;
  onChange: () => void;
  onError: (cause: unknown) => void;
}

/** Tri-state proof: undefined is unknown, null is authorized empty, string is the leading identity. */
export class DataTableServerLeadingRow {
  private configuration: DataTableServerLeadingRowConfiguration | null = null;
  private revision = 0;
  private requestEpoch = 0;
  private active: AbortController | null = null;
  private scheduled = false;
  private needed = false;
  private leading: string | null | undefined;

  /** Update callbacks without retiring the same source/criteria/authority proof. */
  configure(configuration: DataTableServerLeadingRowConfiguration): void {
    const changed = this.configuration?.key !== configuration.key;
    const lostCapability = !!this.configuration?.read && configuration.read === null;
    this.configuration = configuration;
    if (changed || lostCapability) this.clear();
    if (!this.isCurrent()) return;
    this.schedule();
  }

  /** Record the database-change revision captured before a page request starts. */
  captureRevision(): number { return this.revision; }

  /** Demand separate first-row reads only while genuine matching arrivals exist. */
  require(needed: boolean): void {
    this.needed = needed;
    if (!needed) { this.retireRequest(); this.publish(undefined); return; }
    this.schedule();
  }

  /** Any live mutation can reorder the leading result; revoke proof synchronously. */
  invalidate(): void {
    this.revision += 1;
    this.retireRequest();
    this.publish(undefined);
    this.schedule();
  }

  /** A current accepted first page supplies the same authoritative evidence without another lookup. */
  acceptFirstPage(value: string | null, revision: number): void {
    if (revision !== this.revision || !this.isCurrent() || !validIdentity(value)) return;
    this.retireRequest();
    this.publish(value);
  }

  /** Reveal, source retirement and disposal cancel all owned work and evidence. */
  clear(): void {
    this.revision += 1;
    this.needed = false;
    this.retireRequest();
    this.publish(undefined);
  }

  /** Return only the still-current proof; no stale authority survives a silent SDK transition. */
  value(): string | null | undefined {
    return this.isCurrent() ? this.leading : undefined;
  }

  private isCurrent(): boolean {
    if (this.configuration?.isCurrent()) return true;
    this.retireRequest();
    this.leading = undefined;
    return false;
  }

  private publish(value: string | null | undefined): void {
    if (value === this.leading) return;
    this.leading = value;
    this.configuration?.onChange();
  }

  private retireRequest(): void {
    this.requestEpoch += 1;
    this.scheduled = false;
    const active = this.active;
    this.active = null;
    active?.abort();
  }

  private schedule(): void {
    if (!this.needed || !this.configuration?.read || this.leading !== undefined
      || this.active || this.scheduled || !this.isCurrent()) return;
    this.scheduled = true;
    const epoch = this.requestEpoch;
    queueMicrotask(() => {
      if (!this.scheduled || epoch !== this.requestEpoch) return;
      this.scheduled = false;
      void this.read();
    });
  }

  private async read(): Promise<void> {
    if (!this.needed || !this.configuration?.read || !this.isCurrent()) return;
    const controller = new AbortController(), epoch = ++this.requestEpoch, revision = this.revision;
    this.active = controller;
    const current = () => this.active === controller && !controller.signal.aborted
      && epoch === this.requestEpoch && revision === this.revision && this.isCurrent();
    try {
      const value = await this.configuration.read(controller.signal);
      if (!current()) return;
      if (!validIdentity(value)) throw new TypeError('Invalid leading-row identity response.');
      this.active = null;
      this.publish(value);
    } catch (cause) {
      if (!current()) return;
      this.active = null;
      this.configuration?.onError(cause);
      // A failed proof stays unknown/passive, without automatically retrying.
    }
  }
}

function validIdentity(value: unknown): value is string | null {
  return value === null || typeof value === 'string' && value.length > 0 && value.length <= 1_024;
}
