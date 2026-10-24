/** Core optional-payment extension seam. Financial provider engines live in @zero/plugin-payments. */
export type * from './contracts';
export { registerPaymentsBackend, getPaymentsBackend } from './registry';
