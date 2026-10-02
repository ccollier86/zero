/** MAC-sealed Guardian authority attached to durable request-authored events. */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowPersistedExecutionAuthority,
} from './workflow-execution-authority';

const EVENT_AUTHORITY_DOMAIN = 'workflow-event-authority:v2';

export interface WorkflowEventAuthorityEnvelope {
  readonly eventId: string;
  readonly tenantId: string | null;
  readonly instanceId: string;
  readonly eventName: string;
  readonly payloadJson: string | null;
  readonly sentBy: string | null;
  readonly createdAt: string;
  readonly actorJson: string;
}

interface EventAuthorityRow {
  authority_json: string;
  authority_mac: string;
}

export interface PreparedWorkflowEventAuthority {
  readonly authorityJson: string;
  readonly authorityMac: string;
  readonly bytes: number;
}

export type WorkflowEventAuthorityRead =
  | { readonly state: 'none'; readonly authority: null }
  | { readonly state: 'invalid'; readonly authority: null }
  | { readonly state: 'valid'; readonly authority: WorkflowPersistedExecutionAuthority };

export class WorkflowEventAuthorityStore {
  constructor(
    private readonly db: ReactiveDB,
    private readonly authorityStore: WorkflowExecutionAuthorityStore,
  ) {}

  prepare(
    envelope: WorkflowEventAuthorityEnvelope,
    authority: WorkflowPersistedExecutionAuthority,
  ): PreparedWorkflowEventAuthority {
    const seal = this.authorityStore.sealAuthority(
      EVENT_AUTHORITY_DOMAIN,
      authority,
      canonicalEnvelope(envelope),
    );
    return Object.freeze({
      ...seal,
      bytes: Buffer.byteLength(seal.authorityJson, 'utf8')
        + Buffer.byteLength(seal.authorityMac, 'utf8'),
    });
  }

  insert(eventId: string, prepared: PreparedWorkflowEventAuthority, createdAt: string): void {
    this.db.prepare(`INSERT INTO _workflow_event_authorities (
      event_id, authority_json, authority_mac, created_at
    ) VALUES (?, ?, ?, ?)`).run(
      eventId,
      prepared.authorityJson,
      prepared.authorityMac,
      createdAt,
    );
  }

  read(envelope: Omit<WorkflowEventAuthorityEnvelope, 'actorJson'> & {
    actorJson: string | null;
  }): WorkflowEventAuthorityRead {
    const row = this.db.prepare(`SELECT authority_json, authority_mac
      FROM _workflow_event_authorities WHERE event_id = ? LIMIT 1`)
      .get(envelope.eventId) as EventAuthorityRow | null;
    if (!row) return { state: 'none', authority: null };
    if (envelope.actorJson === null) return { state: 'invalid', authority: null };
    const authority = this.authorityStore.openAuthority(
      EVENT_AUTHORITY_DOMAIN,
      canonicalEnvelope(envelope as WorkflowEventAuthorityEnvelope),
      row.authority_json,
      row.authority_mac,
    );
    return authority
      ? { state: 'valid', authority }
      : { state: 'invalid', authority: null };
  }
}

function canonicalEnvelope(envelope: WorkflowEventAuthorityEnvelope): string {
  return JSON.stringify([
    2,
    envelope.eventId,
    envelope.tenantId,
    envelope.instanceId,
    envelope.eventName,
    envelope.payloadJson,
    envelope.sentBy,
    envelope.createdAt,
    envelope.actorJson,
  ]);
}
