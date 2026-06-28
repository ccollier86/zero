/**
 * workflow.plugin.ts
 *
 * Elysia plugin for durable workflows. Defines tables on start,
 * creates the registry/service, registers scheduler jobs for
 * retry polling and timeout checking, and exposes REST routes.
 *
 * Uses auth middleware (resolve-based) — requireAuth is typed,
 * available directly from context. No casts needed.
 */

import Elysia, { t } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getTokenService } from '../auth/auth.plugin';
import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowService } from './workflow-service';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

export interface WorkflowPluginConfig {
  db: ReactiveDB;
}

let _registry: WorkflowRegistry | null = null;
let _service: WorkflowService | null = null;

/** Get the workflow registry (for registering handlers/workflows) */
export function getWorkflowRegistry(): WorkflowRegistry | null {
  return _registry;
}

/** Get the workflow service (for starting/controlling workflows) */
export function getWorkflowService(): WorkflowService | null {
  return _service;
}

export function createWorkflowPlugin(config: WorkflowPluginConfig) {
  return new Elysia({ name: 'workflows', prefix: '/workflows' })

    .use(createAuthMiddleware(getTokenService))

    .onStart(async () => {
      const db = config.db;

      // Define workflow tables (no _ prefix — broadcast via sync engine)
      db.defineTable('workflow_definitions', {
        definition_id: 'text primary key',
        name: 'text unique not null',
        version: 'integer not null default 1',
        steps_json: 'text not null',
        input_schema: 'text',
        created_at: 'text not null',
        updated_at: 'text not null',
      });

      db.defineTable('workflow_instances', {
        instance_id: 'text primary key',
        definition_id: 'text not null',
        name: 'text not null',
        status: "text not null default 'pending'",
        current_step: 'integer not null default 0',
        input: 'text',
        output: 'text',
        error: 'text',
        started_by: 'text',
        steps_json: 'text',
        created_at: 'text not null',
        updated_at: 'text not null',
        completed_at: 'text',
      });

      db.defineTable('workflow_steps', {
        step_id: 'text primary key',
        instance_id: 'text not null',
        step_index: 'integer not null',
        step_name: 'text not null',
        status: "text not null default 'pending'",
        input: 'text',
        output: 'text',
        error: 'text',
        retries: 'integer not null default 0',
        max_retries: 'integer not null default 3',
        retry_at: 'text',
        wait_event: 'text',
        timeout_at: 'text',
        started_at: 'text',
        completed_at: 'text',
        created_at: 'text not null',
      });

      db.defineTable('workflow_events', {
        event_id: 'text primary key',
        instance_id: 'text not null',
        event_name: 'text not null',
        payload: 'text',
        sent_by: 'text',
        created_at: 'text not null',
      });

      _registry = new WorkflowRegistry();
      _service = new WorkflowService(db, _registry);

      // Recover any in-flight steps from a previous crash
      const recovered = await _service.recoverInFlight();
      if (recovered > 0) {
        emitPlatformCode(OBS_CODES.WORKFLOWS_RECOVERED, {
          metadata: { recovered },
        });
      }

      emitPlatformCode(OBS_CODES.WORKFLOWS_INITIALIZED);
    })

    .derive({ as: 'scoped' }, () => {
      if (!_service || !_registry) {
        throw new Error('Workflow service not available');
      }
      return { workflowService: _service, workflowRegistry: _registry };
    })

    // ─── Routes ──────────────────────────────────────

    // List workflow instances
    .get('/', ({ requireAuth, workflowService, query }) => {
      requireAuth();
      return workflowService.listInstances({
        status: query.status ?? undefined,
        name: query.name ?? undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.String()),
        name: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    })

    // List registered workflow definitions
    .get('/definitions', ({ requireAuth, workflowRegistry }) => {
      requireAuth();
      return workflowRegistry.listWorkflows().map(w => ({
        name: w.name,
        steps: w.steps.map(s => ({
          name: s.name,
          handler: s.handler,
          waitFor: s.waitFor,
          condition: s.condition,
        })),
      }));
    })

    // Start a new workflow
    .post('/', async ({ requireAuth, workflowService, body }) => {
      const auth = requireAuth();
      const instanceId = await workflowService.start(
        body.name,
        body.input,
        auth.userId,
      );
      return { instanceId };
    }, {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        input: t.Optional(t.Unknown()),
      }),
    })

    // Get workflow instance
    .get('/:id', ({ requireAuth, workflowService, params, set }) => {
      requireAuth();
      const instance = workflowService.getInstance(params.id);
      if (!instance) {
        set.status = 404;
        return { error: 'Workflow not found' };
      }
      return instance;
    })

    // Get workflow steps
    .get('/:id/steps', ({ requireAuth, workflowService, params }) => {
      requireAuth();
      return workflowService.getSteps(params.id);
    })

    // Get workflow events
    .get('/:id/events', ({ requireAuth, workflowService, params }) => {
      requireAuth();
      return workflowService.getEvents(params.id);
    })

    // Send event to workflow
    .post('/:id/events', async ({ requireAuth, workflowService, params, body }) => {
      const auth = requireAuth();
      const matched = await workflowService.sendEvent(
        params.id,
        body.eventName,
        body.payload,
        auth.userId,
      );
      return { ok: true, matched };
    }, {
      body: t.Object({
        eventName: t.String({ minLength: 1 }),
        payload: t.Optional(t.Unknown()),
      }),
    })

    // Cancel workflow
    .post('/:id/cancel', ({ requireAuth, workflowService, params }) => {
      requireAuth();
      workflowService.cancel(params.id);
      return { ok: true };
    })

    // Pause workflow
    .post('/:id/pause', ({ requireAuth, workflowService, params }) => {
      requireAuth();
      workflowService.pause(params.id);
      return { ok: true };
    })

    // Resume workflow
    .post('/:id/resume', async ({ requireAuth, workflowService, params }) => {
      requireAuth();
      await workflowService.resume(params.id);
      return { ok: true };
    });
}
