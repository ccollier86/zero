/** Executable Torrent proof: durable human review followed by a Fabric write. */

import { t } from 'elysia';

import type { WorkflowExecutionServerServices } from '@zero/framework/server';
import {
  choose,
  expr,
  flow,
  otherwise,
  requestAndWait,
  step,
  when,
  type StepContext,
  type WorkflowRegistry,
} from '@zero/framework/workflows';

import {
  TORRENT_PROOF_RESPONSE_EVENT,
  TORRENT_PROOF_WORKFLOW,
  type TorrentProofInput,
  type TorrentProofResponse,
} from '../shared/torrent-proof';

export const TORRENT_PREPARE_ACTIVITY = 'proof.task.prepare';
export const TORRENT_CREATE_ACTIVITY = 'proof.task.create';
export const TORRENT_DECLINE_ACTIVITY = 'proof.task.decline';

interface PreparedTask {
  readonly taskId: string;
  readonly title: string;
  readonly createdAt: number;
}

type ProofStepContext<TInput> = StepContext<TInput, WorkflowExecutionServerServices>;

const workflowInputSchema = t.Object({
  taskId: t.String({
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
  }),
  title: t.String({ minLength: 1, maxLength: 200, pattern: '\\S' }),
}, { additionalProperties: false });

const preparedTaskSchema = t.Object({
  taskId: t.String(),
  title: t.String(),
  createdAt: t.Integer({ minimum: 0 }),
}, { additionalProperties: false });

const responseSchema = t.Object({
  approved: t.Boolean(),
}, { additionalProperties: false });

/** Register the code-authored activities and immutable v1 proof definition. */
export function registerTorrentProof(registry: WorkflowRegistry): void {
  registry.registerActivity<TorrentProofInput, WorkflowExecutionServerServices>({
    name: TORRENT_PREPARE_ACTIVITY,
    version: '1',
    description: 'Normalize a requested task and server-stamp stable workflow data.',
    inputSchema: workflowInputSchema,
    outputSchema: preparedTaskSchema,
    default: true,
    handler: prepareTask,
  });

  registry.registerActivity<PreparedTask, WorkflowExecutionServerServices>({
    name: TORRENT_CREATE_ACTIVITY,
    version: '1',
    description: 'Create an actor-attributed task in the active Fabric tenant database.',
    inputSchema: preparedTaskSchema,
    outputSchema: t.Object({ taskId: t.String(), created: t.Literal(true) }),
    capabilities: ['database'],
    default: true,
    handler: createApprovedTask,
  });

  registry.registerActivity<TorrentProofResponse, WorkflowExecutionServerServices>({
    name: TORRENT_DECLINE_ACTIVITY,
    version: '1',
    description: 'Close a declined proof without touching tenant application data.',
    inputSchema: responseSchema,
    outputSchema: t.Object({ created: t.Literal(false) }),
    default: true,
    handler: async () => ({ created: false as const }),
  });

  registry.create({
    name: TORRENT_PROOF_WORKFLOW,
    version: 1,
    inputSchema: workflowInputSchema,
    access: {
      start: ['editor', 'manager'],
      inspect: ['viewer', 'editor', 'manager'],
    },
    flow: flow(
      step('prepare-task', TORRENT_PREPARE_ACTIVITY, {
        label: 'Prepare task',
        input: expr.input(),
      }),
      requestAndWait('review-task', TORRENT_PROOF_RESPONSE_EVENT, {
        label: 'Review task',
        request: expr.output('prepare-task'),
        inputSchema: responseSchema,
        maxRejections: 3,
        timeoutMs: 24 * 60 * 60 * 1_000,
      }),
      choose(
        'route-decision',
        { label: 'Route review decision' },
        when(
          expr.eq(expr.output('review-task', 'approved'), true),
          step('create-approved-task', TORRENT_CREATE_ACTIVITY, {
            label: 'Create approved task',
            input: expr.output('prepare-task'),
          }),
        ),
        otherwise(step('record-declined-task', TORRENT_DECLINE_ACTIVITY, {
          label: 'Record declined task',
          input: expr.output('review-task'),
        })),
      ),
    ),
  });
}

async function prepareTask(
  context: ProofStepContext<TorrentProofInput>,
): Promise<PreparedTask> {
  return {
    taskId: context.input.taskId,
    title: context.input.title.trim(),
    createdAt: Date.now(),
  };
}

async function createApprovedTask(
  context: ProofStepContext<PreparedTask>,
): Promise<{ readonly taskId: string; readonly created: true }> {
  const data = context.zero?.data;
  if (!data) throw new Error('The Torrent proof requires a Fabric tenant database scope.');
  if (!context.idempotencyKey) {
    throw new Error('The Torrent proof requires a workflow idempotency key.');
  }
  if (context.execution.kind !== 'actor'
    || !context.execution.userId
    || !context.execution.membershipId) {
    throw new Error('The Torrent proof requires live Guardian actor and membership authority.');
  }

  context.assertCurrentAuthority();
  await data.mutate({
    type: 'create',
    table: 'tasks',
    row: {
      task_id: context.input.taskId,
      title: context.input.title,
      status: 'open',
      created_at: context.input.createdAt,
      created_by_user_id: context.execution.userId,
      assigned_membership_id: context.execution.membershipId,
    },
  }, { idempotencyKey: context.idempotencyKey });

  return { taskId: context.input.taskId, created: true };
}
