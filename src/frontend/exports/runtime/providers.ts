/** Application, client/router and observability providers. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── React: Providers ────────────────────────────────────────────────────
export { AppProvider } from '../../client/app-provider';
export type { AppProviderProps } from '../../client/app-provider';

// ─── React: Error Handling ──────────────────────────────────────────────
export { ErrorBoundary, NotFoundPage } from '../../client/error-boundary';
export {
  CompositeFrontendSink,
  ConsoleFrontendSink,
  HttpFrontendSink,
  FRONTEND_OBS_CODES,
  configureFrontendObservability,
  emitFrontendCode,
  emitFrontendEvent,
  getFrontendObservabilitySink,
} from '../../client/observability';
export type {
  FrontendObservabilityConfig,
  FrontendObservabilityEvent,
  FrontendObservabilitySink,
} from '../../client/observability';
export { ClientProvider } from '../../client/hooks';
export type { ClientProviderProps } from '../../client/hooks';
export { RouterProvider, useNavigationGuard } from '../../client/router-context';
export type { NavigationGuard, NavigationOptions } from '../../client/router-context';
