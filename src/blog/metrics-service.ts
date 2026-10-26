/** Optional signed public observation admission. No IP, fingerprint, account identity, raw URL, article text or browser draft is stored. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { AuthError } from '../auth/types';
import { blogRecord } from './validation';
import { blogId } from './content-validation';
import { contentHash } from './content-rows';
import type { BlogContentRuntime } from './content-runtime';
import type { BlogMetricTicket, BlogMetricObservation } from './metrics-types';

type Ticket = { v: 1; siteId: string; postId: string; nonce: string; issuedAt: number; expiresAt: number };
/** Counts remain low-stakes browser observations. Signed budgets prevent replay/amplification, not bots or fabricated attention. */
export class BlogMetricsService {
  private secret: string | null = null;
  private window = { until: 0, tickets: 0, observations: 0 };
  constructor(private readonly db: ReactiveDB, private readonly content: BlogContentRuntime,
    readonly config: { enabled: boolean; retentionDays: number }, private readonly installAllowed: boolean) {}
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    await withReactiveDBCommitAdmission(this.db, () => this.db.transaction(() => {
      let row = this.db.prepare('SELECT secret FROM _blog_metrics_key WHERE id=1').get() as { secret: string } | null;
      if (!row && this.installAllowed) {
        const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
        this.db.prepare('INSERT INTO _blog_metrics_key(id,secret) VALUES(1,?)').run(secret); row = { secret };
      }
      if (!row || !/^[a-f0-9]{64}$/.test(row.secret)) throw new AuthError('Blog metrics needs a supported installation.', 'BLOG_NOT_READY', 503);
      this.secret = row.secret;
    }));
  }
  issue(siteId: string, postId: string): BlogMetricTicket {
    this.requireEnabled(); this.budget('tickets', 2000);
    const now = Date.now(), value: Ticket = { v: 1, siteId: blogId(siteId), postId: blogId(postId), nonce: crypto.randomUUID(), issuedAt: now, expiresAt: now + 300000 };
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return { ticket: payload + '.' + this.mac(payload), expiresAt: value.expiresAt };
  }
  async observe(siteId: string, postId: string, input: unknown, check: () => void, signal?: AbortSignal): Promise<{ accepted: true; duplicate: boolean }> {
    this.requireEnabled(); this.budget('observations', 5000);
    const r = blogRecord(input, ['ticket', 'observation']);
    const ticket = this.verify(r.ticket), event = blogRecord(r.observation, ['kind', 'observedAt', 'visibleMs']);
    const now = Date.now();
    if (ticket.siteId !== siteId || ticket.postId !== postId || !['view', 'engagement'].includes(String(event.kind)) || !Number.isSafeInteger(event.observedAt)
      || Math.abs(Number(event.observedAt) - now) > 300000 || Number(event.observedAt) < ticket.issuedAt - 5000 || !Number.isSafeInteger(event.visibleMs)
      || Number(event.visibleMs) < 0 || Number(event.visibleMs) > Math.max(0, now - ticket.issuedAt) + 2000 || Number(event.visibleMs) > 300000
      || event.kind === 'view' && event.visibleMs !== 0) throw new AuthError('Invalid blog observation.', 'BLOG_INVALID_INPUT', 422);
    const observation = event as unknown as BlogMetricObservation;
    const fence = () => { check(); this.requireEnabled(); if (ticket.expiresAt <= Date.now()) throw new AuthError('The blog observation ticket expired.', 'BLOG_METRIC_EXPIRED', 409); };
    return this.content.write('blog.metrics.record', { siteId, postId, nonce: ticket.nonce, ...observation, expiresAt: ticket.expiresAt, retentionDays: this.config.retentionDays },
      `blog-observation:${contentHash([ticket.nonce, event.kind])}`, fence, signal);
  }
  private verify(input: unknown): Ticket {
    if (typeof input !== 'string' || input.length > 1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input)) throw new AuthError('Invalid blog observation ticket.', 'BLOG_INVALID_INPUT', 422);
    const [payload, mac] = input.split('.'), actual = Buffer.from(mac!, 'base64url'), expected = Buffer.from(this.mac(payload!), 'base64url');
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) throw new AuthError('Invalid blog observation ticket.', 'BLOG_INVALID_INPUT', 422);
    let value: Record<string, unknown>;
    try { value = blogRecord(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')), ['v', 'siteId', 'postId', 'nonce', 'issuedAt', 'expiresAt']); }
    catch { throw new AuthError('Invalid blog observation ticket.', 'BLOG_INVALID_INPUT', 422); }
    blogId(value.siteId); blogId(value.postId); blogId(value.nonce);
    if (value.v !== 1 || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) - Number(value.issuedAt) !== 300000 || Number(value.issuedAt) > Date.now() + 5000 || Number(value.expiresAt) <= Date.now()) {
      throw new AuthError('The blog observation ticket expired.', 'BLOG_METRIC_EXPIRED', 409);
    }
    return value as unknown as Ticket;
  }
  private mac(value: string) { return createHmac('sha256', Buffer.from(this.secret!, 'hex')).update(value).digest('base64url'); }
  private requireEnabled() { if (!this.config.enabled || !this.secret) throw new AuthError('Blog metrics is disabled.', 'BLOG_METRICS_DISABLED', 503); }
  private budget(kind: 'tickets' | 'observations', limit: number) {
    const now = performance.now();
    if (this.window.until <= now) this.window = { until: now + 60000, tickets: 0, observations: 0 };
    if (++this.window[kind] > limit) throw new AuthError('The optional blog metrics budget is exhausted.', 'BLOG_CAPACITY', 429);
  }
}
