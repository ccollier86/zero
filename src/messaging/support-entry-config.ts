/** Explicit same-origin public admission and narrower staff routing. No browser chooses an organization or trusted policy. */
import type { AccessRequirement } from '../auth/authorization-kernel';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import type { ResolvedMessagingAssistant } from './assistant-config';
import { messagingHash, messagingId, messagingInteger, messagingRecord, messagingRegistry, messagingText } from './validation';
export interface MessagingSupportEntryConfig {
  origin: string;
  /** Required in multi tenancy, forbidden in single tenancy. The tenant must already exist and be active. */
  tenantId?: string;
  staff?: AccessRequirement;
  assistant?: string | false;
  title?: string;
  sessionTtlSeconds?: number;
  /** Hard retained visitor/conversation budget. Hitting it requires deliberate operator capacity review. */
  maxVisitors?: number;
}
export interface ResolvedMessagingSupportEntry {
  readonly id: string; readonly origin: string; readonly tenantId: string | null; readonly staff?: AccessRequirement;
  readonly assistantId: string | null; readonly title: string; readonly sessionTtlSeconds: number; readonly maxVisitors: number; readonly policyHash: string;
}
export function resolveMessagingSupportEntries(input: unknown, auth: NormalizedAuthBehaviorConfig, assistants: Readonly<Record<string, ResolvedMessagingAssistant>>, defaultAssistantId: string | null): Readonly<Record<string, ResolvedMessagingSupportEntry>> {
  const entries: Record<string, ResolvedMessagingSupportEntry> = Object.create(null);
  for (const [id, value] of Object.entries(messagingRegistry(input ?? {}, 32))) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw new Error('[messaging] Invalid public support entry name.');
    const r = messagingRecord(value, ['origin', 'tenantId', 'staff', 'assistant', 'title', 'sessionTtlSeconds', 'maxVisitors']);
    let url: URL; try { url = new URL(messagingText(r.origin, 2000)); } catch { throw new Error('[messaging] A public support entry requires an exact origin.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.origin !== r.origin || url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('[messaging] Public support requires HTTPS (HTTP is allowed only on loopback).');
    const tenantId = r.tenantId === undefined ? null : messagingId(r.tenantId);
    if (auth.tenancy.mode === 'multi' ? tenantId === null : tenantId !== null) throw new Error('[messaging] Public support scope must match Guardian tenancy.');
    const staff = r.staff === undefined ? undefined : structuredClone(r.staff) as AccessRequirement;
    if (staff !== undefined) createAuthorizationKernel(auth).compile(staff, { user: 'required', credentials: ['session'] });
    const assistantId = r.assistant === false ? null : r.assistant === undefined ? defaultAssistantId : messagingText(r.assistant, 64);
    if (assistantId !== null && (!assistants[assistantId] || assistants[assistantId]!.access !== undefined)) throw new Error('[messaging] Public support requires a dedicated assistant without internal Guardian access restrictions.');
    const policy = { id, origin: url.origin, tenantId, ...(staff === undefined ? {} : { staff }), assistantId, title: messagingText(r.title ?? 'Support', 200),
      sessionTtlSeconds: messagingInteger(r.sessionTtlSeconds ?? 86400, 60, 7 * 86400), maxVisitors: messagingInteger(r.maxVisitors ?? 10000, 1, 100000) };
    entries[id] = freeze({ ...policy, policyHash: messagingHash(policy) });
  }
  return Object.freeze(entries);
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
