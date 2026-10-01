/**
 * Prepared persistence and query boundary for the durable workflow engine.
 *
 * Reads use indexed SQLite statements instead of loading whole workflow tables
 * into JavaScript. Writes still pass through ReactiveDB so its transaction,
 * change-stream, and Sync semantics remain intact.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from './types';

export interface WorkflowInstanceListFilter {
  status?: string;
  name?: string;
  startedBy?: string;
  limit?: number;
}

export interface PersistedWorkflowDefinitionInput {
  name: string;
  stepsJson: string;
  inputSchema: string | null;
  now: string;
}

type WorkflowRow = Record<string, unknown>;
type PreparedStatement = ReturnType<ReactiveDB['prepare']>;

export class WorkflowRepository {
  private readonly instanceById: PreparedStatement;
  private readonly stepById: PreparedStatement;
  private readonly stepsByInstance: PreparedStatement;
  private readonly eventsByInstance: PreparedStatement;
  private readonly definitionByName: PreparedStatement;
  private readonly previousStepOutput: PreparedStatement;
  private readonly dueRetryInstances: PreparedStatement;
  private readonly timeoutCandidates: PreparedStatement;
  private readonly nonterminalInstances: PreparedStatement;
  private readonly runningStepsForDisposal: PreparedStatement;
  private readonly listStatements = new Map<number, PreparedStatement>();

  constructor(private readonly db: ReactiveDB) {
    this.instanceById = db.prepare(`
      SELECT * FROM workflow_instances WHERE instance_id = ?
    `);
    this.stepById = db.prepare(`
      SELECT * FROM workflow_steps WHERE step_id = ?
    `);
    this.stepsByInstance = db.prepare(`
      SELECT * FROM workflow_steps
      WHERE instance_id = ?
      ORDER BY step_index ASC, rowid ASC
    `);
    this.eventsByInstance = db.prepare(`
      SELECT * FROM workflow_events
      WHERE instance_id = ?
      ORDER BY created_at ASC, rowid ASC
    `);
    this.definitionByName = db.prepare(`
      SELECT * FROM workflow_definitions WHERE name = ? LIMIT 1
    `);
    this.previousStepOutput = db.prepare(`
      SELECT output FROM workflow_steps
      WHERE instance_id = ? AND step_index = ?
      ORDER BY rowid ASC
    `);
    this.dueRetryInstances = db.prepare(`
      SELECT retry.instance_id
      FROM workflow_steps AS retry
      INNER JOIN workflow_instances AS instance
        ON instance.instance_id = retry.instance_id
      WHERE instance.status = 'running'
        AND retry.status = 'failed'
        AND retry.retry_at IS NOT NULL
        AND retry.retry_at <= ?
        AND retry.step_id = (
          SELECT frontier.step_id
          FROM workflow_steps AS frontier
          WHERE frontier.instance_id = retry.instance_id
            AND frontier.status NOT IN ('completed', 'skipped')
          ORDER BY frontier.step_index ASC, frontier.rowid ASC
          LIMIT 1
        )
      ORDER BY retry.rowid ASC
    `);
    this.timeoutCandidates = db.prepare(`
      SELECT timeout.*
      FROM workflow_steps AS timeout
      INNER JOIN workflow_instances AS instance
        ON instance.instance_id = timeout.instance_id
      WHERE instance.status = 'running'
        AND timeout.timeout_at IS NOT NULL
        AND timeout.timeout_at <= ?
        AND (
          timeout.status IN ('pending', 'waiting', 'running')
          OR (timeout.status = 'failed' AND timeout.retry_at IS NOT NULL)
        )
        AND timeout.step_id = (
          SELECT frontier.step_id
          FROM workflow_steps AS frontier
          WHERE frontier.instance_id = timeout.instance_id
            AND frontier.status NOT IN ('completed', 'skipped')
          ORDER BY frontier.step_index ASC, frontier.rowid ASC
          LIMIT 1
        )
      ORDER BY timeout.timeout_at ASC, timeout.rowid ASC
    `);
    this.nonterminalInstances = db.prepare(`
      SELECT * FROM workflow_instances
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY rowid ASC
    `);
    this.runningStepsForDisposal = db.prepare(`
      SELECT step.*
      FROM workflow_steps AS step
      INNER JOIN workflow_instances AS instance
        ON instance.instance_id = step.instance_id
      WHERE instance.status = 'running' AND step.status = 'running'
      ORDER BY step.rowid ASC
    `);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  getInstance(instanceId: string): WorkflowInstanceRecord | null {
    return (this.instanceById.get(instanceId) as WorkflowInstanceRecord | null) ?? null;
  }

  getStep(stepId: string): WorkflowStepRecord | null {
    return (this.stepById.get(stepId) as WorkflowStepRecord | null) ?? null;
  }

  getSteps(instanceId: string): WorkflowStepRecord[] {
    return this.stepsByInstance.all(instanceId) as WorkflowStepRecord[];
  }

  getEvents(instanceId: string): WorkflowRow[] {
    return this.eventsByInstance.all(instanceId) as WorkflowRow[];
  }

  getPreviousStepOutput(instanceId: string, stepIndex: number): unknown {
    const rows = this.previousStepOutput.all(instanceId, stepIndex - 1) as Array<{
      output: unknown;
    }>;
    if (rows.length !== 1) {
      throw new TypeError(
        `Workflow step ${stepIndex} requires exactly one predecessor at index ${stepIndex - 1}`,
      );
    }
    return rows[0]!.output;
  }

  listInstances(filter: WorkflowInstanceListFilter = {}): WorkflowRow[] {
    const hasStatus = Boolean(filter.status);
    const hasName = Boolean(filter.name);
    const hasStartedBy = Boolean(filter.startedBy);
    // Preserve the existing contract: zero and negative limits do not limit.
    const hasLimit = typeof filter.limit === 'number' && filter.limit > 0;
    const key = Number(hasStatus)
      | (Number(hasName) << 1)
      | (Number(hasStartedBy) << 2)
      | (Number(hasLimit) << 3);
    let statement = this.listStatements.get(key);
    if (!statement) {
      const predicates: string[] = [];
      if (hasStatus) predicates.push('status = ?');
      if (hasName) predicates.push('name = ?');
      if (hasStartedBy) predicates.push('started_by = ?');
      statement = this.db.prepare(`
        SELECT * FROM workflow_instances
        ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
        ORDER BY created_at DESC, rowid ASC
        ${hasLimit ? 'LIMIT ?' : ''}
      `);
      this.listStatements.set(key, statement);
    }
    const values: Array<string | number> = [];
    if (hasStatus) values.push(filter.status!);
    if (hasName) values.push(filter.name!);
    if (hasStartedBy) values.push(filter.startedBy!);
    if (hasLimit) values.push(filter.limit!);
    return statement.all(...values) as WorkflowRow[];
  }

  listDueRetryInstanceIds(now: string): string[] {
    return (this.dueRetryInstances.all(now) as Array<{ instance_id: string }>)
      .map((row) => row.instance_id);
  }

  listTimeoutCandidates(now: string): WorkflowStepRecord[] {
    return this.timeoutCandidates.all(now) as WorkflowStepRecord[];
  }

  listNonterminalInstances(): WorkflowInstanceRecord[] {
    return this.nonterminalInstances.all() as WorkflowInstanceRecord[];
  }

  listRunningStepsForDisposal(): WorkflowStepRecord[] {
    return this.runningStepsForDisposal.all() as WorkflowStepRecord[];
  }

  findDefinition(name: string): WorkflowDefinitionRecord | null {
    return (this.definitionByName.get(name) as WorkflowDefinitionRecord | null) ?? null;
  }

  persistDefinition(input: PersistedWorkflowDefinitionInput): string {
    return this.db.transaction(() => {
      const existing = this.findDefinition(input.name);
      if (existing) {
        if (existing.steps_json !== input.stepsJson
          || existing.input_schema !== input.inputSchema) {
          this.updateDefinition(existing.definition_id, {
            version: Number(existing.version) + 1,
            steps_json: input.stepsJson,
            input_schema: input.inputSchema,
            updated_at: input.now,
          });
        }
        return existing.definition_id;
      }

      const definitionId = crypto.randomUUID();
      this.insertDefinition({
        definition_id: definitionId,
        name: input.name,
        version: 1,
        steps_json: input.stepsJson,
        input_schema: input.inputSchema,
        created_at: input.now,
        updated_at: input.now,
      });
      return definitionId;
    });
  }

  createInstance(instance: WorkflowRow, steps: WorkflowRow[]): void {
    this.db.transaction(() => {
      const instanceId = String(instance.instance_id ?? '');
      if (!instanceId || this.getInstance(instanceId)) {
        throw new Error(`Workflow instance "${instanceId}" already exists`);
      }
      this.insertInstance(instance);
      for (const step of steps) this.insertStep(step);
    });
  }

  insertDefinition(row: WorkflowRow): void {
    this.db.insert('workflow_definitions', row);
  }

  insertInstance(row: WorkflowRow): void {
    this.db.insert('workflow_instances', row);
  }

  insertStep(row: WorkflowRow): void {
    this.db.insert('workflow_steps', row);
  }

  insertEvent(row: WorkflowRow): void {
    this.db.insert('workflow_events', row);
  }

  updateDefinition(definitionId: string, changes: WorkflowRow): void {
    this.db.update('workflow_definitions', definitionId, changes);
  }

  updateInstance(instanceId: string, changes: WorkflowRow): void {
    this.db.update('workflow_instances', instanceId, changes);
  }

  updateStep(stepId: string, changes: WorkflowRow): void {
    this.db.update('workflow_steps', stepId, changes);
  }
}
