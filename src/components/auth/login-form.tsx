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

import { cn } from '@/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/animate-ui/components/radix/checkbox';
import { PasswordInput } from '@/components/auth/password-input';
import { AuthHeader } from '@/components/auth/auth-header';
import { SocialLoginGroup, type SocialProvider } from '@/components/auth/social-login-group';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';
import {
  getAuthDisplayMessage,
  getAuthErrorCode,
  reportAuthUiError,
} from './auth-error';
import {
  canShowForgotPasswordLink,
  canShowRegistrationLink,
} from './auth-config-ui-policy';

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
  showRememberMe?: boolean;
  registerHref?: string;
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
  showRememberMe = false,
  registerHref = '#register',
  socialProviders,
  className,
}: LoginFormProps) {
  const { login, isLoading, error } = useAuth();
  const authConfig = useAuthConfig();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      const code = getAuthErrorCode(err);
      if (code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.();
      if (code === 'ACCOUNT_SUSPENDED') onAccountSuspended?.();
      reportAuthUiError('login', err);
      setLocalError(getAuthDisplayMessage(err, 'Login failed'));
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-3', className)}>
      <AuthHeader title="Sign in" description="Enter your credentials to continue" />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="login-email" className="text-sm font-medium">Username or email</Label>
          <Input
            id="login-email"
            type="text"
            placeholder="you@example.com"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn('h-8 text-sm', displayError && 'border-destructive/50 focus-visible:ring-destructive/30')}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password" className="text-sm font-medium">Password</Label>
            {canShowForgotPassword && (
              <a
                href={forgotPasswordHref}
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </a>
            )}
          </div>
          <PasswordInput
            id="login-password"
            placeholder="Enter password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn('h-8 text-sm', displayError && 'border-destructive/50 focus-visible:ring-destructive/30')}
          />
        </div>

        {showRememberMe && (
          <div className="flex items-center gap-2">
            <Checkbox id="login-remember" size="sm" />
            <Label htmlFor="login-remember" className="text-xs font-normal text-muted-foreground cursor-pointer">
              Remember me
            </Label>
          </div>
        )}
      </div>

      <AnimatePresence>
        {displayError && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0, x: [0, -6, 6, -4, 4, 0] }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
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

      <Button type="submit" size="sm" className="w-full h-8" disabled={isLoading}>
        {isLoading ? (
          <AnimateIcon animate loop>
            <Loader size={16} />
          </AnimateIcon>
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
          <a href={registerHref} className="text-primary hover:underline">
            Sign up
          </a>
        </p>
      )}
    </form>
  );
}

export { LoginForm, type LoginFormProps };
