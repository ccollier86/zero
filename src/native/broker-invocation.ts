/** Bounded, error-normalized invocation of a trusted native-auth broker transport. */

import { createOperationSignal, raceWithSignal } from './abort';
import type {
  NativeAuthBrokerRequest, NativeAuthBrokerResponse,
  NativeAuthBrokerSnapshot, NativeAuthBrokerTransport,
} from './broker-types';
import { NativeAuthError, toNativeAuthError } from './errors';

export async function invokeNativeAuthBroker(input: {
  transport: NativeAuthBrokerTransport;
  command: NativeAuthBrokerRequest;
  source?: AbortSignal;
  timeoutMs: number;
  publish: (snapshot: NativeAuthBrokerSnapshot) => void;
}): Promise<Extract<NativeAuthBrokerResponse, { ok: true }>> {
  const bounded = createOperationSignal(
    input.source, input.timeoutMs, 'Native auth broker request timed out.',
  );
  try {
    const response = await raceWithSignal(
      input.transport.request(input.command, { signal: bounded.signal }), bounded.signal,
    );
    input.publish(response.snapshot);
    if (!response.ok) {
      throw new NativeAuthError(response.error.message, response.error.code, response.error.status);
    }
    return response;
  } catch (error) {
    throw toNativeAuthError(error, 'NATIVE_BROKER_TRANSPORT_FAILED');
  } finally {
    bounded.dispose();
  }
}

export function positiveBrokerTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new NativeAuthError('Broker timeouts must be positive.', 'NATIVE_TIMEOUT_INVALID');
  }
  return value;
}
