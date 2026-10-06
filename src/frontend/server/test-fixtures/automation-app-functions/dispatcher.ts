/**
 * App-owned function dispatcher used by the Fabric automation acceptance test.
 * It owns exact target/argument admission and downstream idempotency. It is not
 * a Zero function registry or an alternative authentication transport.
 */
import type { DatabaseFunctionInvocation } from '../../../../database-automations';
import type { DatabaseAutomationExecutionServerServices } from '../../../server';

export interface FixtureFunctionArguments {
  recordId: string;
  title: string;
  labels: string[];
  multiplier: number;
  requestedTenantId: string;
  foreignRecordId: string;
  behavior: 'normal' | 'retry-once' | 'blocked';
}

interface InvocationContext {
  zero: DatabaseAutomationExecutionServerServices;
  signal: AbortSignal;
  invocation: DatabaseFunctionInvocation;
}

export interface FixtureFunctionCall {
  name: string;
  version: number;
  parameters: FixtureFunctionArguments;
  invocationId: string;
  functionIdentity: string;
  idempotencyKey: string;
  tenantId: string | null;
  signal: AbortSignal;
  zero: DatabaseAutomationExecutionServerServices;
  foreignRecord: unknown;
  accepted: boolean;
  errorCode?: string;
}

export const functionCalls: FixtureFunctionCall[] = [];
const barriers = new Map<string, { entered(): void; wait: Promise<void>; release(): void }>();

/** Hold one app invocation before its downstream mutation, without holding SQLite. */
export function blockAppFunction(recordId: string): { entered: Promise<void>; release(): void } {
  let entered!: () => void;
  let release!: () => void;
  const barrier = {
    entered: new Promise<void>((resolve) => { entered = resolve; }),
    wait: new Promise<void>((resolve) => { release = resolve; }),
  };
  barriers.set(recordId, { entered, wait: barrier.wait, release });
  return { entered: barrier.entered, release };
}

/** Release only test-owned waits so teardown cannot strand a handler. */
export function resetAppFunctionFixture(): void {
  for (const barrier of barriers.values()) barrier.release();
  barriers.clear();
  functionCalls.length = 0;
}

/** Invoke an exact app function with parameters and the caller's sealed context. */
export async function invokeAppFunction(
  name: string,
  version: number,
  parameters: FixtureFunctionArguments,
  context: InvocationContext,
): Promise<void> {
  if (name !== 'documents.publish' || version !== 2) {
    throw new Error('The exact application function version is unavailable.');
  }
  const { zero, signal, invocation } = context;
  signal.throwIfAborted();
  const data = zero.data;
  if (!data) throw new Error('The scoped application database is unavailable.');
  const idempotencyKey = `app:${new Bun.CryptoHasher('sha256')
    .update('fixture.app-function.v1\0').update(invocation.invocationId)
    .update('\0').update(invocation.functionIdentity).update('\0publish').digest('hex')}`;
  const call: FixtureFunctionCall = {
    name, version, parameters, invocationId: invocation.invocationId,
    functionIdentity: invocation.functionIdentity, idempotencyKey,
    tenantId: zero.scope.tenantId, signal, zero, foreignRecord: null, accepted: false,
  };
  functionCalls.push(call);
  try {
    // A requested tenant in business parameters is never a database selector.
    call.foreignRecord = (await data.get('published_documents', parameters.foreignRecordId)).value;
    const barrier = barriers.get(parameters.recordId);
    if (barrier) {
      barrier.entered();
      await waitOrAbort(barrier.wait, signal);
    }
    signal.throwIfAborted();
    await data.mutate({
      type: 'create', table: 'published_documents', row: {
        id: parameters.recordId, title: parameters.title,
        labels: JSON.stringify(parameters.labels), score: parameters.multiplier * 7,
        actual_tenant_id: zero.scope.tenantId!,
      },
    }, { idempotencyKey });
    call.accepted = true;
    if (parameters.behavior === 'retry-once'
      && functionCalls.filter((entry) => entry.invocationId === invocation.invocationId).length === 1) {
      throw new Error('Synthetic lost acknowledgment after the app effect was accepted.');
    }
  } catch (error) {
    call.errorCode = error && typeof error === 'object' && 'code' in error
      ? String(error.code) : signal.aborted ? 'ABORTED' : 'APP_FUNCTION_FAILED';
    throw error;
  }
}

function waitOrAbort(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    wait.then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
  });
}
