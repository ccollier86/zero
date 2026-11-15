/** Request-local, code-owned presentation policy. Never calls a parser, eligibility callback, workflow or provider. */
import { AuthError } from '../auth/types';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { JobActionAvailability, JobActionUnavailableReason, JobDefinitionPage, JobScheduleActions, JobScheduleView } from './contracts';
import type { JobDefinition, JobDefinitionCatalog } from './definition';
import { JobsError } from './error';
import type { JobActor } from './realm-model';

interface DefinitionAccess { readonly definition: JobDefinition; readonly allowed: boolean; readonly service: boolean }
const allowed: JobActionAvailability = Object.freeze({ allowed: true, reason: null });
const denied = (reason: JobActionUnavailableReason): JobActionAvailability => Object.freeze({ allowed: false, reason });

/** At most the bounded registered catalog (256 entries), evaluated once per admitted read request. */
export class JobOperatorPolicy {
  private readonly entries: readonly DefinitionAccess[];
  private readonly exact = new Map<string, DefinitionAccess>();
  private readonly replacement = { actor: false, service: false };
  constructor(catalog: JobDefinitionCatalog, scopeKind: ServiceDataScope['scopeKind'], authorize: (definition: JobDefinition) => void) {
    this.entries = catalog.list().map(definition => {
      let access = true;
      try { authorize(definition); }
      catch (error) {
        if (!(error instanceof AuthError) || ![401, 403].includes(error.status)) throw error;
        access = false;
      }
      return { definition, allowed: access, service: definition.service?.scopes.includes(scopeKind) === true };
    });
    for (const entry of this.entries) {
      this.exact.set(definitionKey(entry.definition.name, entry.definition.version), entry);
      if (entry.definition.default && entry.allowed) {
        this.replacement.actor = true;
        if (entry.service) this.replacement.service = true;
      }
    }
  }
  definitions(): JobDefinitionPage {
    const items = this.entries.filter(entry => entry.allowed).map(({ definition, service }) => ({
      name: definition.name, version: definition.version, default: definition.default, ownership: { actor: true as const, service },
    }));
    items.sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
    return { items };
  }
  actions(actor: JobActor, schedule: JobScheduleView): JobScheduleActions {
    // Do not turn a denied resource into a capability oracle. Native queries enforce this too.
    if (!actor.manageAll && schedule.ownerId !== actor.userId) throw new JobsError('JOBS_NOT_FOUND');
    if (schedule.control === 'cancelled') {
      const unavailable = denied('cancelled');
      return { pause: unavailable, cancel: unavailable, resume: unavailable, update: unavailable, runNow: unavailable };
    }
    const exact = this.exact.get(definitionKey(schedule.definition, schedule.definitionVersion));
    const current = definitionAction(exact, schedule.runAs);
    const owner = schedule.runAs !== 'actor' || actor.userId === schedule.ownerId;
    // An update can explicitly choose another authorized default definition to repair a retired registration.
    const replacement = this.replacement[schedule.runAs];
    return { pause: allowed, cancel: allowed,
      resume: owner ? current : denied('owner-required'),
      update: !owner ? denied('owner-required') : current.allowed || replacement ? allowed : current,
      // runNow creates an independent admission under the initiator, never impersonates the schedule owner.
      runNow: current };
  }
}
function definitionAction(entry: DefinitionAccess | undefined, ownership: JobScheduleView['runAs']): JobActionAvailability {
  return !entry ? denied('definition-unavailable') : !entry.allowed ? denied('access-denied')
    : ownership === 'service' && !entry.service ? denied('ownership-unavailable') : allowed;
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function definitionKey(name: string, version: string): string { return name + ':' + version; }
