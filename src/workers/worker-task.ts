/** Code-owned task definitions. Version changes are required when handler/validation semantics change. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AccessRequirement } from '../auth/authorization-kernel';
import { WorkerError } from './worker-error';
import { workerRecord, workerValue, type WorkerValue } from './worker-value';

export interface WorkerTaskDefinition<Input, Output> {
  name: string;
  version: string;
  /** Parse/validate semantic input; both parent and child enforce this contract. */
  parseInput(value: WorkerValue): Input;
  /** Validate/shape output before it crosses the IPC boundary. */
  parseOutput(value: WorkerValue): Output;
  run(input: Input): Output | Promise<Output>;
  /** Managed admission only; omitted means platform administrator, not public. */
  access?: AccessRequirement;
}
declare const workerTaskTypes: unique symbol;
export interface WorkerTask<Input = unknown, Output = unknown> {
  /** Type-only contract; never serialized or used as runtime authority. */
  readonly [workerTaskTypes]?: { readonly input: Input; readonly output: Output };
  readonly name: string;
  readonly version: string;
  readonly access: AccessRequirement;
  readonly parseInput: (value: unknown) => WorkerValue;
  readonly parseOutput: (value: unknown) => WorkerValue;
  readonly invoke: (input: unknown) => Promise<WorkerValue>;
}
export type WorkerTaskInput<Task extends WorkerTask> = NonNullable<Task[typeof workerTaskTypes]>['input'];
export type WorkerTaskOutput<Task extends WorkerTask> = NonNullable<Task[typeof workerTaskTypes]>['output'];
const registered = new WeakSet<WorkerTask>();

export function defineWorkerTask<Input, Output>(definition: WorkerTaskDefinition<Input, Output>): WorkerTask<Input, Output> {
  workerRecord(definition, ['name', 'version', 'parseInput', 'parseOutput', 'run', 'access']);
  if (typeof definition.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/.test(definition.name)
    || typeof definition.version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(definition.version)
    || typeof definition.parseInput !== 'function' || typeof definition.parseOutput !== 'function' || typeof definition.run !== 'function') {
    throw new WorkerError('WORKER_CONFIG_INVALID', 'Worker task declaration is invalid.');
  }
  const name = definition.name, version = definition.version, parseInput = definition.parseInput,
    parseOutput = definition.parseOutput, run = definition.run;
  const task: WorkerTask<Input, Output> = Object.freeze({ name, version,
    access: freeze(structuredClone(definition.access ?? 'admin')),
    parseInput: (value: unknown) => parseSafely(parseInput, value),
    parseOutput: (value: unknown) => parseSafely(parseOutput, value),
    invoke: async (value: unknown) => parseSafely(parseOutput, await run(parseSafely(parseInput, value) as Input)),
  });
  registered.add(task); return task;
}

export class WorkerTaskCatalog {
  private readonly tasks = new Map<string, WorkerTask>();
  readonly fingerprint: string;
  constructor(tasks: readonly WorkerTask[]) {
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 256) throw invalid();
    for (const task of tasks) {
      if (!registered.has(task) || this.tasks.has(task.name)) throw invalid();
      this.tasks.set(task.name, task);
    }
    // Portable names/versions, never function.toString() (source and bundles
    // differ). Versions are a code-owner promise, not a hash of executable code.
    this.fingerprint = createHash('sha256').update(JSON.stringify(
      [...this.tasks.values()].map(task => [task.name, task.version]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0))).digest('hex');
  }
  get(name: string): WorkerTask {
    const task = this.tasks.get(name); if (!task) throw new WorkerError('WORKER_TASK_INVALID', 'Worker task is not registered.');
    return task;
  }
  /** References must be the exact registered object, never a same-name weaker contract. */
  resolve(task: string | WorkerTask): WorkerTask {
    if (typeof task === 'string') return this.get(task);
    if (!registered.has(task) || this.tasks.get(task.name) !== task) throw new WorkerError('WORKER_TASK_INVALID', 'Worker task reference is not registered in this catalog.');
    return task;
  }
  list(): readonly WorkerTask[] { return Object.freeze([...this.tasks.values()]); }
}
function invalid() { return new WorkerError('WORKER_CONFIG_INVALID', 'Worker task catalog is invalid.'); }
function parseSafely<T>(parse: (value: WorkerValue) => T, value: unknown): WorkerValue {
  try {
    const canonical = workerValue(parse(workerValue(value)));
    // Input is checked again in the child and output again in the parent. A
    // one-way transform would otherwise silently change it at each boundary.
    // Parsers must be pure; reject a noncanonical contract before dispatch.
    if (!isDeepStrictEqual(canonical, workerValue(parse(workerValue(canonical))))) throw new Error('Noncanonical worker contract.');
    return canonical;
  }
  catch { throw new WorkerError('WORKER_TASK_INVALID', 'Worker input or result failed its registered contract.'); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
