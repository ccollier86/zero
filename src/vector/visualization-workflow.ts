/**
 * visualization-workflow.ts
 *
 * Opt-in Torrent activity adapters for real ingestion/search. Existing workflow
 * ownership, retries and recovery execute them; application code must provide a
 * trusted service resolver and no tenant or provider authority comes from input.
 */
import { createHash } from 'node:crypto';
import { t } from 'elysia';
import { Value } from '@sinclair/typebox/value';
import type { StepContext } from '../workflows/types';
import type { WorkflowRegistry } from '../workflows/workflow-registry';
import { normalizeWorkflowJson } from '../workflows/workflow-json-value';
import { WorkflowError } from '../workflows/workflow-error';
import { VectorError } from './vector-error';
import type { VectorVisualizationService } from './visualization-service';
import type { VectorVisualizationIngestInput, VectorVisualizationSearchInput,
  VectorVisualizationSnapshot } from './visualization-types';

export type VectorVisualizationWorkflowInput = Omit<VectorVisualizationIngestInput, 'operationId'>
  | Omit<VectorVisualizationSearchInput, 'operationId'>;

/** App-owned factory derives scope from the immutable runtime identity, never from input. */
export interface VectorVisualizationWorkflowOptions<TServices = unknown> {
  resolveService: (context: StepContext<unknown, TServices>, input: VectorVisualizationWorkflowInput)
    => Pick<VectorVisualizationService, 'search' | 'ingest'>
      | Promise<Pick<VectorVisualizationService, 'search' | 'ingest'>>;
  names?: { search?: string; ingestion?: string };
  version?: string;
  /** Defaults false: a visual/database author cannot invoke these without app opt-in. */
  databaseCallable?: boolean;
}

/** Completed result includes the existing operation identity for a chat/tool visual to attach. */
export interface VectorVisualizationWorkflowResult {
  operationId: string;
  snapshot: VectorVisualizationSnapshot;
}

const searchSchema = t.Object({ index: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  text: t.String({ minLength: 1, maxLength: 8_192 }),
  retrieval: t.Optional(t.Union([t.Literal('vector'), t.Literal('hybrid')])),
  rerank: t.Optional(t.Boolean()), topK: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  candidateCount: t.Optional(t.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false });
const ingestionSchema = t.Object({ index: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  sourceRevision: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  document: t.Object({ id: t.String({ minLength: 1, maxLength: 256 }), title: t.String({ minLength: 1, maxLength: 160 }),
    text: t.String({ maxLength: 48_000 }), clusterId: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
    source: t.Optional(t.Object({ label: t.String({ minLength: 1, maxLength: 96 }),
      id: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
      abbreviation: t.Optional(t.String({ minLength: 1, maxLength: 16 })) }, { additionalProperties: false })) },
  { additionalProperties: false }) }, { additionalProperties: false });

/** Register pinned activity versions; this does not register a workflow or launch any work. */
export function registerVectorVisualizationActivities<TServices = unknown>(registry: WorkflowRegistry,
  options: VectorVisualizationWorkflowOptions<TServices>) {
  if (!options || typeof options.resolveService !== 'function') throw invalid('A trusted vector service resolver is required.');
  const search = { name: options.names?.search ?? 'zero.vector.search', version: options.version ?? '1' };
  const ingestion = { name: options.names?.ingestion ?? 'zero.vector.ingest', version: options.version ?? '1' };
  if (search.name === ingestion.name || registry.activities.get(search.name, search.version)
    || registry.activities.get(ingestion.name, ingestion.version)) throw invalid('Vector activity versions are already registered or conflict.');
  for (const [kind, reference, schema] of [['search', search, searchSchema], ['ingestion', ingestion, ingestionSchema]] as const) {
    registry.registerActivity<unknown, TServices>({ ...reference, inputSchema: schema,
      description: `Execute authorized vector ${kind} and publish backend-driven visualization progress.`,
      capabilities: ['ai', 'database', 'vector'], databaseCallable: options.databaseCallable === true,
      handler: async context => {
        assertContext(context);
        const input = normalizeWorkflowJson(context.input, 'WORKFLOW_ACTIVITY_INPUT_INVALID', 422);
        if (!Value.Check(schema, input)) throw new WorkflowError('Vector activity input is invalid.', 'WORKFLOW_ACTIVITY_INPUT_INVALID', 422);
        const command = input as unknown as VectorVisualizationWorkflowInput;
        const service = await options.resolveService(context, command);
        assertContext(context);
        const operationId = `vvwf_${digest([kind, context.idempotencyKey, context.attemptId])}`;
        const execution = { signal: context.signal, authorityFence: () => context.assertCurrentAuthority() };
        const snapshot = kind === 'search'
          ? await service.search({ ...command as VectorVisualizationSearchInput, operationId }, execution)
          : await service.ingest({ ...command as VectorVisualizationIngestInput, operationId,
            sourceRevision: (command as VectorVisualizationIngestInput).sourceRevision
              ?? digest([context.idempotencyKey, (command as VectorVisualizationIngestInput).document.id,
                (command as VectorVisualizationIngestInput).document.text]) }, execution);
        assertContext(context);
        if (snapshot.status !== 'completed') throw new VectorError('VECTOR_OPERATION_FAILED',
          'Vector workflow activity did not complete.', { operationId: snapshot.id,
            outcomeUnknown: snapshot.error?.outcomeUnknown === true });
        return { operationId: snapshot.id, snapshot } satisfies VectorVisualizationWorkflowResult;
      },
    });
  }
  return { search: Object.freeze(search), ingestion: Object.freeze(ingestion) };
}

function assertContext(context: StepContext): void {
  if (!context || typeof context.assertCurrentAuthority !== 'function' || !context.idempotencyKey
    || !context.attemptId || !context.signal || !Number.isSafeInteger(context.attempt)
    || context.attempt < 0) throw invalid('A live Torrent attempt context is required.');
  context.assertCurrentAuthority();
  if (context.signal?.aborted) throw new VectorError('VECTOR_SCOPE_CONFLICT', 'Workflow attempt has been retired.');
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function invalid(message: string): VectorError { return new VectorError('VECTOR_CONFIG_INVALID', message); }
