'use client';

/**
 * login-form.tsx
 *
 * Renders the reusable Zero login form. This file owns login UI state,
 * auth-config-aware links, and frontend error reporting only; auth transport
 * and lifecycle enforcement remain in the SDK and backend routes.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { PasswordInput } from '#zero/components/auth/password-input';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AuthFlowContinuation } from '#zero/components/auth/auth-flow-continuation';
import { SocialLoginGroup, type SocialProvider } from '#zero/components/auth/social-login-group';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import {
  getAuthDisplayMessage,
  getAuthErrorCode,
  reportAuthUiError,
} from './auth-error';
import {
  canShowForgotPasswordLink,
  canShowRegistrationLink,
} from './auth-config-ui-policy';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';
import {
  type AuthFlowContinuationResult,
  isAuthFlowContinuationResult,
} from './auth-continuation';
import { useNativeAuthRoute, useNativeLoginHint } from './use-native-auth-route';
import { AuthConfigLoadState } from './auth-config-load-state';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Props that control route links and lifecycle callbacks for LoginForm. */
interface LoginFormProps {
  onSuccess?: () => void;
  onPasswordChangeRequired?: () => void;
  onAccountSuspended?: () => void;
  showForgotPassword?: boolean;
  forgotPasswordHref?: string;
  showRegisterLink?: boolean;
  respectRegistrationPolicy?: boolean;
  /**
   * @deprecated Accepted for source compatibility. Session persistence is
   * controlled by the server and this prop does not render a checkbox.
   */
  showRememberMe?: boolean;
  registerHref?: string;
  identifierLabel?: string;
  identifierPlaceholder?: string;
  identifierAutoComplete?: React.HTMLInputAutoCompleteAttribute;
  socialProviders?: SocialProvider[];
  className?: string;
}

// ─── LoginForm ───────────────────────────────────────────────────────────────

/** Render a config-aware login form backed by the shared auth client. */
function LoginForm({
  onSuccess,
  onPasswordChangeRequired,
  onAccountSuspended,
  showForgotPassword = true,
  forgotPasswordHref = '#forgot-password',
  showRegisterLink = true,
  respectRegistrationPolicy = true,
  registerHref = '#register',
  identifierLabel = 'Username or email',
  identifierPlaceholder = 'you@example.com',
  identifierAutoComplete = 'username',
  socialProviders,
  className,
}: LoginFormProps) {
  const {
    login,
    isLoading,
    error,
    authenticationContinuation,
    clearAuthenticationContinuation,
  } = useAuth();
  const authConfig = useAuthConfig();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const loginHint = useNativeLoginHint();
  const [authContinuation, setAuthContinuation] = React.useState<
    AuthFlowContinuationResult | null
  >(null);
  const activeAuthContinuation = authContinuation
    ?? (isAuthFlowContinuationResult(authenticationContinuation)
      ? authenticationContinuation
      : null);
  const fieldId = React.useId();
  const emailId = `${fieldId}-email`;
  const passwordId = `${fieldId}-password`;

  const displayError = localError ?? error;
  const canShowRegisterLink = canShowRegistrationLink(
    showRegisterLink,
    respectRegistrationPolicy,
    authConfig,
  );
  const canShowForgotPassword = canShowForgotPasswordLink(
    showForgotPassword,
    respectRegistrationPolicy,
    authConfig,
  );
  const continuedRegisterHref = useNativeAuthRoute(registerHref);
  const continuedForgotPasswordHref = useNativeAuthRoute(forgotPasswordHref);

  React.useEffect(() => {
    if (loginHint) setEmail((current) => current || loginHint);
  }, [loginHint]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    try {
      const result = await login(email, password);
      if (isAuthFlowContinuationResult(result)) {
        setAuthContinuation(result);
        return;
      }
      onSuccess?.();
    } catch (err) {
      const code = getAuthErrorCode(err);
      if (code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.();
      if (code === 'ACCOUNT_SUSPENDED') onAccountSuspended?.();
      reportAuthUiError('login', err);
      setLocalError(getAuthDisplayMessage(err, 'Login failed'));
    }
  }

  if (activeAuthContinuation) {
    return (
      <AuthFlowContinuation
        result={activeAuthContinuation}
        onSuccess={onSuccess}
        onBack={() => {
          clearAuthenticationContinuation();
          setAuthContinuation(null);
        }}
        className={className}
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('space-y-4', className)}
      aria-busy={isLoading}
    >
      <AuthHeader title="Sign in" description="Enter your credentials to continue" />

      <AuthConfigLoadState
        state={authConfig}
        loadingMessage="Loading account options…"
        unavailableMessage="Account registration and recovery options could not be loaded. You can still sign in."
      />

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={emailId} className="text-sm font-medium">{identifierLabel}</Label>
          <Input
            id={emailId}
            type="text"
            placeholder={identifierPlaceholder}
            autoComplete={identifierAutoComplete}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={passwordId} className="text-sm font-medium">Password</Label>
            {canShowForgotPassword && (
              <a
                href={continuedForgotPasswordHref}
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </a>
            )}
          </div>
          <PasswordInput
            id={passwordId}
            placeholder="Enter password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
          />
        </div>

      </div>

      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={authFeedbackInitial}
            animate={authFeedbackAnimate}
            exit={authFeedbackExit}
            transition={authPresenceTransition}
            className="overflow-hidden"
          >
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5"
              role="alert"
            >
              <AnimateIcon animate>
                <CircleX size={16} className="mt-px flex-shrink-0 text-destructive" />
              </AnimateIcon>
              <p className="text-xs font-medium leading-relaxed text-destructive">
                {displayError}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Button type="submit" className="h-10 w-full" disabled={isLoading}>
        {isLoading ? (
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">Signing in</span>
          </>
        ) : (
          'Sign in'
        )}
      </Button>

      {socialProviders && socialProviders.length > 0 && (
        <SocialLoginGroup providers={socialProviders} />
      )}

      {canShowRegisterLink && (
        <p className="text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{' '}
          <a href={continuedRegisterHref} className="text-primary hover:underline">
            Sign up
          </a>
        </p>
      )}
    </form>
  );
}

export { LoginForm, type LoginFormProps };
