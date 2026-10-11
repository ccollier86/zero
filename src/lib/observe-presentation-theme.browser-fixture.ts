/** Expose only the shared observer to a synthetic browser harness; no React/provider/configuration or application services. */
import { observePresentationTheme } from './observe-presentation-theme';
declare global { interface Window { __observePresentationTheme: typeof observePresentationTheme } }
window.__observePresentationTheme = observePresentationTheme;
