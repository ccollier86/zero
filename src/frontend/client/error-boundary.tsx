import { Component, createElement } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ErrorBoundaryProps {
  /** Optional custom fallback component. Receives error + reset function. */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
  /** Called when an error is caught. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ─── Error Boundary ─────────────────────────────────────────────────────────

/**
 * Platform error boundary. Catches render errors in the component tree
 * and shows a styled error page instead of a white screen.
 *
 * In development: shows error details, stack trace, and a retry button.
 * In production: shows a user-friendly error message with retry.
 *
 * Apps can override the fallback UI by passing a `fallback` prop.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    emitFrontendCode(OBS_CODES.FRONTEND_RENDER_ERROR, {
      error,
      metadata: { componentStack: errorInfo.componentStack },
    });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return createElement(DefaultErrorPage, {
        error: this.state.error,
        reset: this.reset,
      });
    }
    return this.props.children;
  }
}

// ─── Default Error Page ─────────────────────────────────────────────────────

interface DefaultErrorPageProps {
  error: Error;
  reset: () => void;
}

function DefaultErrorPage({ error, reset }: DefaultErrorPageProps) {
  const isDev = typeof process !== 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : true;

  return createElement('div', { style: containerStyle },
    createElement('div', { style: cardStyle },
      createElement('div', { style: iconStyle }, '!'),
      createElement('h1', { style: titleStyle }, 'Something went wrong'),
      isDev
        ? createElement('div', { style: errorDetailStyle },
            // Error name (e.g. "TypeError", "RangeError") — red monospace
            createElement('span', { style: errorNameStyle }, error.name),
            // Error message — amber/warning color
            createElement('p', { style: errorMessageStyle }, error.message),
          )
        : createElement('p', { style: messageStyle },
            'An unexpected error occurred. Please try again.'
          ),
      isDev && error.stack
        ? createElement('pre', { style: stackStyle },
            createElement('code', null, formatStack(error.stack))
          )
        : null,
      createElement('div', { style: actionsStyle },
        createElement('button', {
          style: buttonPrimaryStyle,
          onClick: reset,
        }, 'Try Again'),
        createElement('button', {
          style: buttonSecondaryStyle,
          onClick: () => { if (typeof window !== 'undefined') window.location.reload(); },
        }, 'Reload Page'),
      ),
    ),
  );
}

/**
 * Format a stack trace for readability:
 * - Strip the first line (error message, already shown separately)
 * - Trim leading whitespace on each frame
 */
function formatStack(stack: string): string {
  const lines = stack.split('\n');
  // First line is usually "ErrorName: message" — skip it since we show it above
  const frames = lines.slice(1);
  return frames.map((line) => line.trim()).join('\n');
}

// ─── Not Found Page ─────────────────────────────────────────────────────────

export function NotFoundPage() {
  return createElement('div', { style: containerStyle },
    createElement('div', { style: cardStyle },
      createElement('div', { style: { ...iconStyle, background: '#3b82f6' } }, '?'),
      createElement('h1', { style: titleStyle }, '404'),
      createElement('p', { style: { ...messageStyle, fontSize: '1.25rem' } }, 'Page not found'),
      createElement('p', { style: messageStyle },
        'The page you\'re looking for doesn\'t exist or has been moved.'
      ),
      createElement('div', { style: actionsStyle },
        createElement('button', {
          style: buttonPrimaryStyle,
          onClick: () => {
            if (typeof window !== 'undefined') {
              window.history.pushState(null, '', '/');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          },
        }, 'Go Home'),
        createElement('button', {
          style: buttonSecondaryStyle,
          onClick: () => { if (typeof window !== 'undefined') window.history.back(); },
        }, 'Go Back'),
      ),
    ),
  );
}

// ─── Server Error Page (used by renderer for SSR errors) ────────────────────

export function serverErrorHtml(error: Error, isDev: boolean): string {
  const errorDetail = isDev
    ? `<div style="background:#1a1a24;border:1px solid #2d2d3d;border-radius:0.5rem;padding:1rem 1.25rem;margin-bottom:0.5rem;text-align:left">
        <span style="color:#f87171;font-family:'SF Mono','Fira Code','JetBrains Mono',Consolas,monospace;font-size:0.8rem;font-weight:600;letter-spacing:0.025em">${escapeHtml(error.name)}</span>
        <p style="color:#fbbf24;font-size:0.95rem;font-weight:500;margin:0.5rem 0 0;line-height:1.5;word-break:break-word">${escapeHtml(error.message)}</p>
      </div>`
    : `<p style="color:#94a3b8;margin:0 0 1.5rem">An unexpected error occurred.</p>`;

  const stack = isDev && error.stack
    ? `<pre style="background:#1e1e2e;color:#a6adc8;padding:1rem;border-radius:0.5rem;overflow-x:auto;font-size:0.75rem;margin-top:0.5rem;text-align:left;max-height:24rem;line-height:1.6;border:1px solid #2d2d3d"><code>${escapeHtml(error.stack.split('\n').slice(1).map(l => l.trim()).join('\n'))}</code></pre>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;padding:1rem">
  <div style="max-width:48rem;width:100%;text-align:center">
    <div style="width:3rem;height:3rem;border-radius:50%;background:#ef4444;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;margin-bottom:1.5rem">!</div>
    <h1 style="font-size:1.5rem;font-weight:600;margin:0 0 0.75rem">Something went wrong</h1>
    ${errorDetail}
    ${stack}
    <button onclick="location.reload()" style="margin-top:1.5rem;padding:0.625rem 1.25rem;background:#3b82f6;color:white;border:none;border-radius:0.375rem;font-size:0.875rem;font-weight:500;cursor:pointer">Reload Page</button>
  </div>
</body>
</html>`;
}

export function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — Not Found</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0">
  <div style="max-width:36rem;width:100%;padding:2rem;text-align:center">
    <div style="width:3rem;height:3rem;border-radius:50%;background:#3b82f6;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;margin-bottom:1.5rem">?</div>
    <h1 style="font-size:3rem;font-weight:700;margin:0 0 0.5rem">404</h1>
    <p style="font-size:1.25rem;color:#94a3b8;margin:0 0 0.5rem">Page not found</p>
    <p style="color:#64748b;margin:0 0 2rem">The page you're looking for doesn't exist or has been moved.</p>
    <a href="/" style="padding:0.625rem 1.25rem;background:#3b82f6;color:white;border:none;border-radius:0.375rem;font-size:0.875rem;font-weight:500;cursor:pointer;text-decoration:none">Go Home</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Inline Styles (no CSS dependency) ──────────────────────────────────────

const containerStyle: Record<string, string> = {
  margin: '0',
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0f0f14',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: '#e2e8f0',
  padding: '1rem',
};

const cardStyle: Record<string, string> = {
  maxWidth: '48rem',
  width: '100%',
  textAlign: 'center',
};

const iconStyle: Record<string, string> = {
  width: '3rem',
  height: '3rem',
  borderRadius: '50%',
  background: '#ef4444',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.5rem',
  fontWeight: '700',
  marginBottom: '1.5rem',
};

const titleStyle: Record<string, string> = {
  fontSize: '1.5rem',
  fontWeight: '600',
  margin: '0 0 0.75rem',
};

const messageStyle: Record<string, string> = {
  color: '#94a3b8',
  margin: '0 0 1rem',
  lineHeight: '1.6',
};

const errorDetailStyle: Record<string, string> = {
  background: '#1a1a24',
  border: '1px solid #2d2d3d',
  borderRadius: '0.5rem',
  padding: '1rem 1.25rem',
  marginBottom: '0.5rem',
  textAlign: 'left',
};

const errorNameStyle: Record<string, string> = {
  color: '#f87171',
  fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
  fontSize: '0.8rem',
  fontWeight: '600',
  letterSpacing: '0.025em',
};

const errorMessageStyle: Record<string, string> = {
  color: '#fbbf24',
  fontSize: '0.95rem',
  fontWeight: '500',
  margin: '0.5rem 0 0',
  lineHeight: '1.5',
  wordBreak: 'break-word',
};

const stackStyle: Record<string, string> = {
  background: '#1e1e2e',
  color: '#a6adc8',
  padding: '1rem',
  borderRadius: '0.5rem',
  overflowX: 'auto',
  fontSize: '0.75rem',
  marginTop: '0.5rem',
  textAlign: 'left',
  maxHeight: '24rem',
  lineHeight: '1.6',
  border: '1px solid #2d2d3d',
};

const actionsStyle: Record<string, string> = {
  display: 'flex',
  gap: '0.75rem',
  justifyContent: 'center',
  marginTop: '1.5rem',
};

const buttonPrimaryStyle: Record<string, string> = {
  padding: '0.625rem 1.25rem',
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: '500',
  cursor: 'pointer',
};

const buttonSecondaryStyle: Record<string, string> = {
  padding: '0.625rem 1.25rem',
  background: 'transparent',
  color: '#94a3b8',
  border: '1px solid #334155',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: '500',
  cursor: 'pointer',
};
