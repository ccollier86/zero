import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';

import { MemoryEventStore } from '../observability/memory-event-store';
import {
  configureObservability,
  getObservabilityRuntime,
} from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import {
  WorkflowInteractionAuthority,
  type WorkflowInteractionActor,
} from './workflow-interaction-authority';
import { WorkflowInteractionService } from './workflow-interaction-service';
import {
  MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES,
  MAX_WORKFLOW_INTERACTION_SUBMISSIONS,
  WorkflowInteractionStore,
} from './workflow-interaction-store';
import { defineWorkflowTables } from './workflow-schema';

const START = Date.parse('2030-01-02T03:04:05.000Z');
const ACTOR: WorkflowInteractionActor = { actorId: 'user-1', roles: ['reviewer'] };
const ALLOW_AUTHORITY = new WorkflowInteractionAuthority(() => true);

let db: ReactiveDB;
let now: number;
let store: WorkflowInteractionStore;
let service: WorkflowInteractionService;

beforeEach(() => {
  db = openDb();
  seedWorkflow(db, 'instance-1');
  now = START;
  store = new WorkflowInteractionStore(db);
  service = new WorkflowInteractionService(store, {
    clock: () => new Date(now),
    authority: ALLOW_AUTHORITY,
  });
});

afterEach(() => db.dispose());

describe('durable workflow interactions', () => {
  test('reserves the event response namespace for the trusted runtime bridge', async () => {
    const interaction = service.open(openInput());
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'external-event-channel',
      actor: ACTOR,
      payload: true,
      channel: 'event',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_INVALID', status: 400 });
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'event:forged',
      actor: ACTOR,
      payload: true,
      channel: 'web',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_INVALID', status: 400 });
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'Event:forged-case',
      actor: ACTOR,
      payload: true,
      channel: 'web',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_INVALID', status: 400 });
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'external-event-channel-case',
      actor: ACTOR,
      payload: true,
      channel: 'EVENT',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_INVALID', status: 400 });
    expect(store.findResponse(interaction.interactionId, 'external-event-channel')).toBeNull();
    expect(store.findResponse(interaction.interactionId, 'event:forged')).toBeNull();
    expect(store.findResponse(interaction.interactionId, 'Event:forged-case')).toBeNull();
    expect(store.findResponse(interaction.interactionId, 'external-event-channel-case')).toBeNull();
  });

  test('never upgrades a legacy external reservation into a trusted event response', async () => {
    const interaction = service.open(openInput());
    const payloadJson = 'true';
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    db.exec('DROP TRIGGER trg_workflow_interaction_response_origin_insert');
    db.prepare(`INSERT INTO _workflow_interaction_responses (
      response_id, interaction_id, submission_id, actor_id, channel,
      payload_hash, payload_json, accepted_value_json, status,
      rejection_code, public_message, created_at, decided_at, origin, event_id
    ) VALUES (?, ?, ?, ?, 'event', ?, ?, NULL, 'processing', NULL, NULL, ?, NULL,
      'external', NULL)`).run(
      'legacy-response',
      interaction.interactionId,
      'event:legacy-event',
      ACTOR.actorId,
      payloadHash,
      payloadJson,
      new Date(START).toISOString(),
    );
    let committed = false;
    await expect(service.submitEvent({
      interactionId: interaction.interactionId,
      eventId: 'legacy-event',
      actor: ACTOR,
      payload: true,
      onDecisionCommit: () => { committed = true; },
    })).rejects.toMatchObject({
      code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT',
      status: 409,
    });
    expect(committed).toBe(false);
    expect(store.findResponse(interaction.interactionId, 'event:legacy-event'))
      .toMatchObject({ origin: 'external', eventId: null, status: 'processing' });
  });

  test('fails closed when no responder authority adapter is configured', async () => {
    service = new WorkflowInteractionService(store, { clock: () => new Date(now) });
    const interaction = service.open(openInput());
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'denied-by-default',
      actor: ACTOR,
      payload: 'no implicit access',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_FORBIDDEN', status: 403 });
  });

  test('persists before arbitrary delivery and recovers the wait by step', async () => {
    const delivered = await service.openAndDeliver(openInput(), async (interaction) => {
      expect(store.get(interaction.interactionId)?.status).toBe('open');
      expect(store.getByStep('instance-1', 'step-1')?.interactionId)
        .toBe(interaction.interactionId);
    });
    expect(delivered.delivered).toBe(true);

    const failed = await service.openAndDeliver({ ...openInput(), stepId: 'step-2' }, () => {
      throw new Error('email provider unavailable');
    });
    expect(failed.delivered).toBe(false);
    expect(store.get(failed.interaction.interactionId)?.status).toBe('open');
  });

  test('reports delivery and authority adapter failures with their original causes', async () => {
    const previous = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    try {
      const deliveryError = new Error('delivery dependency failed');
      const delivery = await service.openAndDeliver(openInput(), () => {
        throw deliveryError;
      });
      expect(delivery.delivered).toBe(false);
      expect(events.query({ code: 'workflows.interaction.delivery_failed' }).events[0])
        .toMatchObject({
          error: deliveryError,
          metadata: {
            interactionId: delivery.interaction.interactionId,
            instanceId: 'instance-1',
            nodeId: 'approval-node',
          },
        });

      const authorityError = new Error('policy backend unavailable');
      service = new WorkflowInteractionService(store, {
        clock: () => new Date(now),
        authority: new WorkflowInteractionAuthority(() => {
          throw authorityError;
        }),
      });
      const interaction = service.open({ ...openInput(), stepId: 'step-2' });
      await expect(service.submit({
        interactionId: interaction.interactionId,
        submissionId: 'policy-failure',
        actor: ACTOR,
        payload: true,
      })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_FORBIDDEN', status: 403 });
      expect(events.query({
        code: 'workflows.interaction.authority_evaluation_failed',
      }).events[0]).toMatchObject({
        error: authorityError,
        metadata: {
          interactionId: interaction.interactionId,
          instanceId: 'instance-1',
          nodeId: 'approval-node',
        },
      });
    } finally {
      configureObservability(previous);
    }
  });

  test('keeps policy, schemas, submissions, and accepted values out of the public row', async () => {
    const interaction = service.open({
      ...openInput(),
      responderPolicy: { role: 'reviewer' },
      responseSchema: Type.Object({ code: Type.String() }),
      validatorActivityId: 'normalize-code',
    });
    const publicRow = db.get('workflow_interactions', interaction.interactionId)!;
    expect(Object.keys(publicRow)).not.toContain('responder_policy_json');
    expect(Object.keys(publicRow)).not.toContain('response_schema_json');
    expect(Object.keys(publicRow)).not.toContain('payload_json');
    expect(Object.keys(publicRow)).not.toContain('accepted_value_json');
  });

  test('authorizes responders, validates TypeBox JSON, and resumes with normalized private data', async () => {
    const authority = new WorkflowInteractionAuthority(({ actor, responderPolicy }) => {
      const role = (responderPolicy as Record<string, unknown>).role;
      return actor.roles?.includes(String(role)) ?? false;
    });
    service = new WorkflowInteractionService(store, {
      clock: () => new Date(now),
      authority,
      validateActivity: async (activityId, context) => {
        expect(activityId).toBe('normalize-code');
        const payload = context.payload as Record<string, unknown>;
        return { valid: true, value: { code: String(payload.code).trim().toUpperCase() } };
      },
    });
    const interaction = service.open({
      ...openInput(),
      responderPolicy: { role: 'reviewer' },
      responseSchema: Type.Object({ code: Type.String({ minLength: 1 }) }),
      validatorActivityId: 'normalize-code',
    });

    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'unauthorized',
      actor: { actorId: 'outsider', roles: ['viewer'] },
      payload: { code: 'abc' },
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_FORBIDDEN' });
    const invalid = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'invalid-schema',
      actor: ACTOR,
      payload: { code: 42 },
      channel: 'email',
    });
    expect(invalid).toMatchObject({
      outcome: 'rejected', rejectionCode: 'schema_invalid',
      interaction: { status: 'open', rejectionCount: 1 },
    });

    const accepted = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'valid',
      actor: ACTOR,
      payload: { code: ' abc ' },
      channel: 'web',
    });
    expect(accepted).toMatchObject({ outcome: 'accepted', interaction: { status: 'accepted' } });
    expect(service.getAcceptedValue(interaction.interactionId)).toEqual({ code: 'ABC' });

    const response = store.findResponse(interaction.interactionId, 'valid')!;
    expect(JSON.parse(response.payloadJson)).toEqual({ code: ' abc ' });
    expect(JSON.parse(response.acceptedValueJson!)).toEqual({ code: 'ABC' });
    expect(response.payloadHash).toHaveLength(64);
    expect(accepted).not.toHaveProperty('payload');
  });

  test('makes submission IDs idempotent and rejects changed replay payloads', async () => {
    const interaction = service.open({
      ...openInput(), responseSchema: Type.String(),
    });
    const first = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'submission-1',
      actor: ACTOR,
      payload: 'approved',
    });
    const replay = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'submission-1',
      actor: ACTOR,
      payload: 'approved',
    });
    expect(replay).toEqual(first);
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'submission-1',
      actor: ACTOR,
      payload: 'changed',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT' });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ?
    `).get(interaction.interactionId)).toEqual({ count: 1 });
  });

  test('binds an in-flight submission ID to its original actor', async () => {
    const authorized = deferred<void>();
    let authorityCalls = 0;
    service = new WorkflowInteractionService(store, {
      clock: () => new Date(now),
      authority: new WorkflowInteractionAuthority(async () => {
        authorityCalls += 1;
        await authorized.promise;
        return { allowed: true, revision: 'stable', assertCurrent: () => true };
      }),
    });
    const interaction = service.open({
      ...openInput(), responseSchema: Type.String(),
    });
    const first = service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'shared-id',
      actor: ACTOR,
      payload: 'approved',
    });
    await Promise.resolve();
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'shared-id',
      actor: { actorId: 'different-user', roles: ['reviewer'] },
      payload: 'approved',
    })).rejects.toMatchObject({
      code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT', status: 409,
    });
    expect(authorityCalls).toBe(1);
    authorized.resolve();
    expect((await first).outcome).toBe('accepted');
  });

  test('binds submission identity atomically across separate service instances', async () => {
    const releaseAuthority = deferred<void>();
    const bothEntered = deferred<void>();
    let authorityCalls = 0;
    const authority = new WorkflowInteractionAuthority(async () => {
      authorityCalls += 1;
      if (authorityCalls === 2) bothEntered.resolve();
      await releaseAuthority.promise;
      return { allowed: true, revision: 'stable', assertCurrent: () => true };
    });
    const firstService = new WorkflowInteractionService(store, {
      clock: () => new Date(now), authority,
    });
    const secondService = new WorkflowInteractionService(store, {
      clock: () => new Date(now), authority,
    });
    const interaction = firstService.open({
      ...openInput(), responseSchema: Type.String(),
    });
    const submissions = [firstService, secondService].map((candidate, index) => candidate.submit({
      interactionId: interaction.interactionId,
      submissionId: 'cross-service-id',
      actor: { actorId: `actor-${index}` },
      payload: 'approved',
    }));
    await bothEntered.promise;
    releaseAuthority.resolve();
    const outcomes = await Promise.allSettled(submissions);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((entry) => entry.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT', status: 409 },
    });
    expect(db.prepare(`SELECT COUNT(*) AS count
      FROM _workflow_interaction_responses WHERE interaction_id = ?`)
      .get(interaction.interactionId)).toEqual({ count: 1 });
    await Promise.all([firstService.dispose(), secondService.dispose()]);
  });

  test('revalidates mutable app policy inside the final response transaction', async () => {
    const validatorEntered = deferred<void>();
    const releaseValidator = deferred<void>();
    let policyRevision = 'membership:1';
    const authority = new WorkflowInteractionAuthority(() => {
      const captured = policyRevision;
      return {
        allowed: true,
        revision: captured,
        assertCurrent: (expected) => policyRevision === expected,
      };
    });
    service = new WorkflowInteractionService(store, {
      clock: () => new Date(now),
      authority,
      validateActivity: async () => {
        validatorEntered.resolve();
        await releaseValidator.promise;
        return true;
      },
    });
    const interaction = service.open({
      ...openInput(),
      responseSchema: Type.String(),
      validatorActivityId: 'slow-policy-validator',
    });
    const pending = service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'revoked-during-validation',
      actor: ACTOR,
      payload: 'approved',
    });
    await validatorEntered.promise;
    policyRevision = 'membership:2';
    releaseValidator.resolve();

    await expect(pending).rejects.toMatchObject({
      code: 'WORKFLOW_INTERACTION_FORBIDDEN', status: 403,
    });
    expect(service.get(interaction.interactionId)).toMatchObject({ status: 'open' });
    expect(store.findResponse(
      interaction.interactionId,
      'revoked-during-validation',
    )).toBeNull();
    expect(interactionResponseUsage(interaction.interactionId)).toEqual({
      response_count: 0,
      response_bytes: 0,
    });
  });

  test('reserves at most the bounded number of unique submissions atomically', async () => {
    const interaction = service.open({
      ...openInput(), responseSchema: Type.String(),
    });
    for (let index = 0; index < MAX_WORKFLOW_INTERACTION_SUBMISSIONS - 1; index += 1) {
      store.beginSubmission(submissionInput(
        interaction.interactionId, `seed-${index}`, `actor-${index}`, 'null',
      ));
    }
    const boundary = await Promise.allSettled(['last-a', 'last-b'].map((submissionId) => (
      Promise.resolve().then(() => store.beginSubmission(submissionInput(
        interaction.interactionId, submissionId, ACTOR.actorId, 'null',
      )))
    )));
    expect(boundary.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(boundary.find((entry) => entry.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'WORKFLOW_INTERACTION_SUBMISSION_LIMIT', status: 429, retryable: false,
      },
    });
    const usage = interactionResponseUsage(interaction.interactionId);
    expect(usage.response_count).toBe(MAX_WORKFLOW_INTERACTION_SUBMISSIONS);
    const replayId = boundary.find((entry) => entry.status === 'fulfilled')!.value.submissionId;
    expect(store.beginSubmission(submissionInput(
      interaction.interactionId, replayId, ACTOR.actorId, 'null',
    )).submissionId).toBe(replayId);
    expect(() => store.beginSubmission(submissionInput(
      interaction.interactionId, replayId, 'different-actor', 'null',
    ))).toThrow(expect.objectContaining({
      code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT', status: 409,
    }));
  });

  test('enforces the aggregate interaction-response byte budget without partial rows', () => {
    const interaction = service.open({
      ...openInput(), responseSchema: Type.String(),
    });
    const chunkBytes = MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES / 16;
    const payloadJson = JSON.stringify('x'.repeat(chunkBytes - 2));
    expect(Buffer.byteLength(payloadJson, 'utf8')).toBe(chunkBytes);
    for (let index = 0; index < 16; index += 1) {
      store.beginSubmission(submissionInput(
        interaction.interactionId, `chunk-${index}`, ACTOR.actorId, payloadJson,
      ));
    }
    expect(interactionResponseUsage(interaction.interactionId)).toEqual({
      response_count: 16,
      response_bytes: MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES,
    });
    expect(() => store.beginSubmission(submissionInput(
      interaction.interactionId, 'one-byte-too-many', ACTOR.actorId, 'null',
    ))).toThrow(expect.objectContaining({
      code: 'WORKFLOW_INTERACTION_SUBMISSION_LIMIT', status: 429, retryable: false,
    }));
    expect(db.prepare(`SELECT COUNT(*) AS count
      FROM _workflow_interaction_responses WHERE interaction_id = ?`)
      .get(interaction.interactionId)).toEqual({ count: 16 });
  });

  test('chooses exactly one winner across overlapping valid responses', async () => {
    const barrier = deferred<void>();
    service = new WorkflowInteractionService(store, {
      clock: () => new Date(now),
      authority: ALLOW_AUTHORITY,
      validateActivity: async () => {
        await barrier.promise;
        return true;
      },
    });
    const interaction = service.open({
      ...openInput(),
      responseSchema: Type.Number(),
      validatorActivityId: 'accept',
    });
    const pending = Array.from({ length: 50 }, (_, index) => service.submit({
      interactionId: interaction.interactionId,
      submissionId: `submission-${index}`,
      actor: { actorId: `user-${index}` },
      payload: index,
    }));
    await Promise.resolve();
    barrier.resolve();
    const results = await Promise.all(pending);
    expect(results.filter((result) => result.outcome === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'superseded')).toHaveLength(49);
    const acceptedRows = db.prepare(`
      SELECT COUNT(*) AS count FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND status = 'accepted'
    `).get(interaction.interactionId);
    expect(acceptedRows).toEqual({ count: 1 });
    expect(service.getAcceptedValue(interaction.interactionId)).not.toBeNull();
  });

  test('allows bounded invalid retries, then closes at the configured limit', async () => {
    const interaction = service.open({
      ...openInput(), responseSchema: Type.Number(), maxRejections: 2,
    });
    const first = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'bad-1', actor: ACTOR, payload: 'no',
    });
    expect(first.interaction).toMatchObject({ status: 'open', rejectionCount: 1 });
    const second = await service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'bad-2', actor: ACTOR, payload: 'still no',
    });
    expect(second.interaction).toMatchObject({ status: 'rejection_limit', rejectionCount: 2 });
    await expect(service.submit({
      interactionId: interaction.interactionId,
      submissionId: 'bad-3', actor: ACTOR, payload: 3,
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_REJECTION_LIMIT' });
  });

  test('expires waits deterministically and cancels every open wait for a terminal instance', async () => {
    const expiring = service.open({
      ...openInput(), expiresAt: new Date(START + 1_000).toISOString(),
    });
    now += 1_000;
    expect(service.expire(expiring.interactionId).status).toBe('expired');
    await expect(service.submit({
      interactionId: expiring.interactionId,
      submissionId: 'late', actor: ACTOR, payload: 'late',
    })).rejects.toMatchObject({ code: 'WORKFLOW_INTERACTION_EXPIRED' });

    service.open({ ...openInput(), stepId: 'step-2' });
    service.open({ ...openInput(), stepId: 'step-3' });
    expect(service.cancelForInstance('instance-1').map((entry) => entry.status))
      .toEqual(['cancelled', 'cancelled']);
  });
});

test('accepted interaction state survives a file-backed restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zero-workflow-interaction-'));
  const path = join(directory, 'workflow.db');
  let first: ReactiveDB | null = null;
  let second: ReactiveDB | null = null;
  try {
    first = openDb(path);
    seedWorkflow(first, 'restart-instance');
    const firstService = new WorkflowInteractionService(new WorkflowInteractionStore(first), {
      clock: () => new Date(START),
      authority: ALLOW_AUTHORITY,
    });
    const opened = firstService.open({
      ...openInput(), instanceId: 'restart-instance', responseSchema: Type.String(),
    });
    await firstService.submit({
      interactionId: opened.interactionId,
      submissionId: 'accepted', actor: ACTOR, payload: 'durable',
    });
    first.dispose();
    first = null;

    second = openDb(path);
    const recovered = new WorkflowInteractionStore(second);
    expect(recovered.get(opened.interactionId)?.status).toBe('accepted');
    expect(recovered.getAcceptedValue(opened.interactionId)).toBe('durable');
  } finally {
    first?.dispose();
    second?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function openInput() {
  return {
    instanceId: 'instance-1', nodeId: 'approval-node', stepId: 'step-1',
    safeLabel: 'Approval required',
  };
}

function openDb(path?: string): ReactiveDB {
  const database = createReactiveDB({ mode: path ?? 'memory' });
  defineWorkflowTables(database);
  return database;
}

function seedWorkflow(database: ReactiveDB, instanceId: string): void {
  const definitionId = `definition-${instanceId}`;
  const timestamp = new Date(START).toISOString();
  database.insert('workflow_definitions', {
    definition_id: definitionId, name: definitionId, steps_json: '[]',
    created_at: timestamp, updated_at: timestamp,
  });
  database.insert('workflow_instances', {
    instance_id: instanceId, definition_id: definitionId, name: definitionId,
    input: null, steps_json: '[]', created_at: timestamp, updated_at: timestamp,
  });
  database.prepare(`INSERT INTO _workflow_runtime_usage (instance_id, runtime_bytes)
    VALUES (?, 0)`).run(instanceId);
  database.prepare(`INSERT INTO _workflow_event_usage (
    instance_id, total_count, total_bytes, queued_count, queued_bytes, revision
  ) VALUES (?, 0, 0, 0, 0, 0)`).run(instanceId);
}

function submissionInput(
  interactionId: string,
  submissionId: string,
  actorId: string,
  payloadJson: string,
) {
  return {
    interactionId,
    submissionId,
    actorId,
    origin: 'external' as const,
    payloadHash: createHash('sha256').update(payloadJson).digest('hex'),
    payloadJson,
    now: new Date(START).toISOString(),
  };
}

function interactionResponseUsage(interactionId: string) {
  return db.prepare(`SELECT response_count, response_bytes
    FROM _workflow_interaction_details WHERE interaction_id = ? LIMIT 1`)
    .get(interactionId) as { response_count: number; response_bytes: number };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
