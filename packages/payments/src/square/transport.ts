/** Square SDK transport fences every physical mutation. SDK retries are disabled; ambiguous non-idempotent writes cannot be resent. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { SquareClient, SquareEnvironment, SquareError } from 'square';
import { PaymentsError } from '../errors';
import { canonical, hash } from '../store';
import type { PaymentsResources } from '../resources';
import type { ResolvedSquareOptions } from './options';
import { SQUARE_API_VERSION } from './options';

export interface SquareExecution { key: string; assertCurrent(): void; assertAuthority?(): void; resourceFences?: Set<() => void>; attempted: boolean; accepted: boolean; blocked?: unknown }
export const squareWireKey = (key: string) => 'zero-' + hash(key).slice(0, 40);
export class SquareTransport {
  private readonly executions = new AsyncLocalStorage<SquareExecution>();
  private readonly deadlines = new AsyncLocalStorage<AbortSignal>();
  private readonly shutdown = new AbortController();
  readonly native: SquareClient;
  get active() { return this.executions.getStore(); }
  run<T>(execution: SquareExecution, run: () => Promise<T>): Promise<T> { return this.executions.run(execution, run); }
  outside<T>(run: () => T): T { return this.executions.exit(() => this.deadlines.exit(run)); }
  async bounded<T>(timeoutMs: number, run: () => Promise<T>): Promise<T> {
    if (this.deadlines.getStore()) return run();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    try { return await this.deadlines.run(controller.signal, run); } finally { clearTimeout(timer); }
  }
  stop() { this.shutdown.abort(); }
  constructor(options: ResolvedSquareOptions, resources: PaymentsResources) {
    const origin = options.mode === 'test' ? SquareEnvironment.Sandbox : SquareEnvironment.Production;
    const delegate = options.fetch ?? globalThis.fetch;
    const physical = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== new URL(origin).origin) throw new PaymentsError('Square transport origin changed.', 'PAYMENTS_MERCHANT_MISMATCH', 503);
      const execution = this.active, body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
      const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || /\/(search|batch-retrieve)$/.test(new URL(request.url).pathname);
      let attempt: string | null = null, digest = '';
      if (execution && !readOnly) {
        try {
          execution.assertCurrent(); execution.assertAuthority?.(); execution.resourceFences?.forEach(assert => assert());
          const idempotencyKey = body ? (JSON.parse(body) as { idempotency_key?: unknown }).idempotency_key : undefined;
          if (idempotencyKey !== undefined && idempotencyKey !== squareWireKey(execution.key)) throw new PaymentsError('Square request lost its durable operation key.', 'PAYMENTS_COMMAND_CONFLICT', 409);
          if (idempotencyKey === undefined) {
            attempt = execution.key; digest = hash(canonical([request.method, request.url, body]));
            if (!resources.attempt(attempt, digest)) throw new PaymentsError('This non-idempotent Square write was already attempted. Reconcile its original result; do not resend it.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
          }
        } catch (error) { execution.blocked = error; throw error; }
        execution.attempted = true;
      }
      const deadline = this.deadlines.getStore();
      const response = await delegate(request, { signal: AbortSignal.any([request.signal, this.shutdown.signal, ...(deadline ? [deadline] : [])]) });
      if (execution && !readOnly && response.ok) execution.accepted = true;
      if (attempt && response.status >= 400 && response.status < 500 && response.status !== 408) resources.clearAttempt(attempt, digest);
      return response;
    }, { preconnect: globalThis.fetch.preconnect });
    this.native = new SquareClient({ token: options.accessToken, environment: origin, version: SQUARE_API_VERSION,
      maxRetries: 0, timeoutInSeconds: options.timeoutMs / 1000, fetch: physical, logging: { silent: true } });
  }
}
export function squareError(error: unknown, read = false): PaymentsError {
  if (error instanceof PaymentsError) return error;
  if (read) return new PaymentsError('Square billing information is temporarily unavailable.', 'PAYMENTS_READ_UNAVAILABLE', 503, 'none', true);
  if (error instanceof SquareError && error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) {
    if ([401, 403, 429].includes(error.statusCode)) return new PaymentsError('Square could not admit the operation. Correct configuration or retry the same operation ID.', 'PAYMENTS_PROVIDER_UNAVAILABLE', 503, 'none', true);
    return new PaymentsError('Square rejected this payment operation.', 'PAYMENTS_PROVIDER_REJECTED', 422);
  }
  return new PaymentsError('Square may have accepted the operation. Reconcile the original operation ID.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
}
