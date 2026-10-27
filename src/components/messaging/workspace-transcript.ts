/** One latest projection and at most one visible historical projection; retained bytes are bounded independently. */
import type { DurableMessage, MessagingPage } from '../../messaging/contracts';
import type { MessagingClient, MessagingWatchOptions } from '../../messaging/client-contracts';
export class MessagingWorkspaceTranscript {
  private latest: MessagingPage<DurableMessage> | null = null; private historyFrom = 1; private historyRevision = 0; private historyVisibility: 'conversation' | 'staff' | null = null;
  private stopRange: (() => void) | undefined; private startingRange = false; private rangeEpoch = 0; private rangeStart = 0; private rangeEnd = 0;
  private visible: number | undefined; private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly source: MessagingClient, private readonly id: string,
    private readonly current: () => boolean, private readonly options: MessagingWatchOptions<unknown>,
    private readonly read: () => readonly DurableMessage[], private readonly accept: (rows: readonly DurableMessage[], hasOlder?: boolean, hasNewer?: boolean) => void,
    private readonly following: () => boolean, private readonly maximum: number) {}
  receive(page: MessagingPage<DurableMessage>): void {
    if (!this.current() || !this.admit(page)) return; this.latest = page;
    const incoming = this.merge([], page.items), old = this.read();
    if (old.length && incoming.length && incoming[0]!.sequence > old.at(-1)!.sequence + 1) {
      if (!this.following()) { this.accept(old, undefined, true); return; }
      this.reset(); return;
    }
    const rows = this.merge(old, incoming);
    if (rows.length > this.maximum && !this.following()) { this.accept(old, undefined, true); return; }
    this.accept(rows.slice(-this.maximum), old.length === 0 ? page.hasMore : rows.length > this.maximum ? true : undefined, false);
    this.watchOlder();
  }
  backfill(page: MessagingPage<DurableMessage>): void {
    if (!this.current() || !this.admit(page)) return;
    const rows = this.merge(this.read(), page.items);
    // Slide toward older history instead of making earlier history unreachable.
    // The caller retains at least one overlap row to preserve the visible anchor.
    this.accept(rows.slice(0, this.maximum), page.hasMore, rows.length > this.maximum ? true : undefined);
    this.watchOlder();
  }
  merge(left: readonly DurableMessage[], right: readonly DurableMessage[]): DurableMessage[] {
    const allowed = (row: DurableMessage) => row.sequence >= this.historyFrom && (this.historyVisibility !== 'conversation' || row.visibility === 'conversation');
    const values = new Map(left.filter(allowed).map(row => [row.id, row]));
    for (const row of right) {
      if (row.conversationId !== this.id || !allowed(row)) continue;
      const old = values.get(row.id);
      // Reactions can change without incrementing the authored-message revision.
      if (!old || old.revision < row.revision || old.revision === row.revision && !sameReactions(old, row)) values.set(row.id, row);
    }
    return [...values.values()].sort((a, b) => a.sequence - b.sequence);
  }
  accepted(message: DurableMessage): void {
    if (!this.current()) return;
    const old = this.read(), rows = this.merge(old, [message]);
    if (old.length && message.sequence > old.at(-1)!.sequence + 1 || rows.length > this.maximum && !this.following()) { this.accept(old, undefined, true); return; }
    this.accept(rows.slice(-this.maximum), rows.length > this.maximum ? true : undefined);
  }
  reset(): void {
    if (!this.latest || !this.current()) return;
    this.stopHistorical(); this.visible = undefined;
    this.accept(this.merge([], this.latest.items), this.latest.hasMore, false);
  }
  observe(sequence: number): void {
    if (!this.current() || !Number.isSafeInteger(sequence) || this.visible === sequence) return;
    this.visible = sequence; clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.watchOlder(); }, 120);
  }
  watchOlder(): void {
    if (!this.current()) return;
    const firstLatest = Math.min(...(this.latest?.items.map(row => row.sequence) ?? [Infinity]));
    const rows = this.read(), anchor = rows.find(row => row.sequence === this.visible) ?? rows[0];
    if (!anchor || anchor.sequence >= firstLatest) { this.stopHistorical(); return; }
    if ((this.stopRange || this.startingRange) && anchor.sequence >= this.rangeStart && anchor.sequence <= this.rangeEnd) return;
    this.stopHistorical(); const epoch = this.rangeEpoch;
    this.rangeStart = anchor.sequence; this.rangeEnd = anchor.sequence + 49;
    this.startingRange = true;
    try { const stop = this.source.watchMessages(this.id, page => {
      if (!this.current() || epoch !== this.rangeEpoch || !this.admit(page)) return;
      this.rangeEnd = Math.max(this.rangeStart, ...page.items.map(row => row.sequence));
      const retained = new Set(this.read().map(row => row.id));
      this.accept(this.merge(this.read(), page.items.filter(row => retained.has(row.id))));
      // The byte budget can return fewer than the nominal 50 rows.
      this.watchOlder();
    }, { ...this.options, query: { after: anchor.sequence - 1, limit: 50 } });
      if (epoch === this.rangeEpoch) this.stopRange = stop; else stop();
    } catch { this.options.onError?.(new Error('Historical message updates are unavailable.')); }
    finally { if (epoch === this.rangeEpoch) this.startingRange = false; }
  }
  close(): void { clearTimeout(this.timer); this.stopHistorical(); this.latest = null; }
  private stopHistorical(): void { ++this.rangeEpoch; this.stopRange?.(); this.stopRange = undefined; this.startingRange = false; this.rangeStart = this.rangeEnd = 0; }
  private admit(page: MessagingPage<DurableMessage>): boolean {
    const grant = page.history; if (!grant) return this.historyRevision === 0;
    if (!Number.isSafeInteger(grant.from) || grant.from < 1 || !Number.isSafeInteger(grant.revision) || grant.revision < this.historyRevision) return false;
    if (grant.revision === this.historyRevision && (grant.from !== this.historyFrom || grant.visibility !== this.historyVisibility)) return false;
    const changed = grant.from !== this.historyFrom || this.historyVisibility !== null && grant.visibility !== this.historyVisibility;
    this.historyFrom = grant.from; this.historyRevision = grant.revision; this.historyVisibility = grant.visibility;
    if (changed) { this.stopHistorical(); this.latest = null; this.accept([]); }
    return true;
  }
}
function sameReactions(a: DurableMessage, b: DurableMessage): boolean {
  return a.reactions.length === b.reactions.length && a.reactions.every((row, index) => {
    const other = b.reactions[index]; return !!other && row.emoji === other.emoji && row.count === other.count && row.selected === other.selected;
  });
}
