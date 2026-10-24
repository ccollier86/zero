/** Guards every physical SDK attempt, including the SDK's asynchronous network retries. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type Stripe from 'stripe';
import { PaymentsError } from './errors';

export interface PaymentExecution {
  key: string;
  assertCurrent(): void;
  assertAuthority?(): void;
  attempted: boolean;
  accepted: boolean;
  blocked?: unknown;
}
export class PaymentExecutionBoundary {
  private readonly current = new AsyncLocalStorage<PaymentExecution>();
  get active(): PaymentExecution | undefined { return this.current.getStore(); }
  run<T>(execution: PaymentExecution, run: () => Promise<T>): Promise<T> { return this.current.run(execution, run); }
  outside<T>(run: () => T): T { return this.current.exit(run); }
  transport(delegate: NonNullable<Stripe.StripeConfig['httpClient']>): NonNullable<Stripe.StripeConfig['httpClient']> {
    return {
      getClientName: () => `zero-fenced-${delegate.getClientName()}`,
      makeRequest: async (...args) => {
        const execution = this.active, method = args[3];
        if (!execution || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return delegate.makeRequest(...args);
        try {
          execution.assertCurrent();
          execution.assertAuthority?.();
          if (method === 'POST') {
            const header = Object.entries(args[4]).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
            if (header !== execution.key) throw new PaymentsError('Provider request lost its durable operation key.', 'PAYMENTS_COMMAND_CONFLICT', 409, 'unknown');
          }
        } catch (error) { execution.blocked = error; throw error; }
        execution.attempted = true;
        const response = await delegate.makeRequest(...args);
        if (response.getStatusCode() >= 200 && response.getStatusCode() < 300) execution.accepted = true;
        return response;
      },
    };
  }
}
