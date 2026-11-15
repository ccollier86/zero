/** Browser-safe durable handoff facade. No server imports, automatic replay or detached scope callbacks. */
import type { WorkflowActorStartResult } from '../../workflows/workflow-actor-start-contract';
import type { FetchInit } from './sdk';

export interface WorkflowEnqueueOptions { idempotencyKey: string; version?: number; signal?: AbortSignal }
export interface WorkflowClient {
  enqueueOnce(name: string, input: unknown, options: WorkflowEnqueueOptions): Promise<WorkflowActorStartResult>;
  getStartReceipt(idempotencyKey: string, options?: { signal?: AbortSignal }): Promise<WorkflowActorStartResult | null>;
  /** Retire pending results on account/scope replacement and client disposal. */
  clear(): void;
}
export function createWorkflowClient(fetch: <T = unknown>(path: string, init?: FetchInit) => Promise<T>): WorkflowClient {
  let generation = 0, boundary = new AbortController();
  const call = async (path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> => {
    const captured = generation;
    const combined = AbortSignal.any([boundary.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const result = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: structuredClone(body) }), signal: combined });
    if (captured !== generation || combined.aborted) throw new DOMException('Workflow authority scope changed.', 'AbortError');
    return result;
  };
  return Object.freeze({
    async enqueueOnce(name: string, input: unknown, options: WorkflowEnqueueOptions) {
      if (typeof name !== 'string' || !name.trim() || name.length > 200 || !options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => !['idempotencyKey', 'version', 'signal'].includes(key))) throw invalid();
      const key = requestKey(options.idempotencyKey);
      if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) throw invalid();
      const result = receipt(await call('/workflows/enqueue', { name: name.trim(), ...(input === undefined ? {} : { input }),
        idempotencyKey: key, ...(options.version === undefined ? {} : { version: options.version }) }, options.signal));
      if (result.name !== name.trim()) throw invalid();
      return result;
    },
    async getStartReceipt(key: string, options: { signal?: AbortSignal } = {}) {
      const result = await call('/workflows/starts/' + encodeURIComponent(requestKey(key)), undefined, options.signal);
      return result === null ? null : receipt(result);
    },
    clear() { generation++; boundary.abort(); boundary = new AbortController(); },
  });
}
function receipt(value: unknown): WorkflowActorStartResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 4 || !['instanceId', 'name', 'createdAt', 'definitionVersion'].every(key => Object.hasOwn(r, key))
    || typeof r.instanceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(r.instanceId)
    || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200
    || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))
    || r.definitionVersion !== null && (!Number.isSafeInteger(r.definitionVersion) || Number(r.definitionVersion) < 1)) throw invalid();
  return Object.freeze({ instanceId: r.instanceId, name: r.name, createdAt: r.createdAt, definitionVersion: r.definitionVersion as number | null });
}
function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw invalid();
  return value;
}
function invalid() { return new Error('Invalid workflow handoff request or acknowledgment.'); }
