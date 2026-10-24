/** Exact app ownership: an optional plugin never becomes a process-wide current merchant. */
import type { PaymentsBackend } from './contracts';
const services = new WeakMap<object, PaymentsBackend>();
export function registerPaymentsBackend(owner: object, service: PaymentsBackend): () => void {
  if (services.has(owner)) throw new Error('[payments] This application already has a payments owner.');
  services.set(owner, service); return () => { if (services.get(owner) === service) services.delete(owner); };
}
export function getPaymentsBackend(owner: object): PaymentsBackend | null { return services.get(owner) ?? null; }
