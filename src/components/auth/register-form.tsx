'use client';

/**
 * register-form.tsx
 *
 * Renders the reusable Zero registration form. This file owns public
 * registration UI state and policy-aware visibility only; account creation and
 * first-admin bootstrap rules remain backend responsibilities.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '@/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/auth/password-input';
import { AuthHeader } from '@/components/auth/auth-header';
import { SocialLoginGroup, type SocialProvider } from '@/components/auth/social-login-group';
import { ValidationRules } from '@/components/ui/validation-rules';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  isAuthConfigPending,
  isAuthConfigUnavailable,
  isRegistrationClosed,
} from './auth-config-ui-policy';

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldName = 'email' | 'username' | 'firstName' | 'lastName' | 'password';

/** Props that control registration fields, links, and policy behavior. */
interface RegisterFormProps {
  onSuccess?: () => void;
  showLoginLink?: boolean;
  loginHref?: string;
  fields?: FieldName[];
  showPasswordStrength?: boolean;
  respectRegistrationPolicy?: boolean;
  unavailable?: React.ReactNode;
  socialProviders?: SocialProvider[];
  className?: string;
}

// ─── Username validation rules ───────────────────────────────────────────────

function getUsernameRules(username: string) {
  return [
    { label: '3-20 characters', met: username.length >= 3 && username.length <= 20 },
    { label: 'Letters, numbers, underscores only', met: /^[a-zA-Z0-9_]*$/.test(username) && username.length > 0 },
    { label: 'Starts with a letter', met: /^[a-zA-Z]/.test(username) },
  ];
}

// ─── RegisterForm ────────────────────────────────────────────────────────────

/** Render a registration form that adapts to public registration config. */
function RegisterForm({
  onSuccess,
  showLoginLink = true,
  loginHref = '#login',
  fields = ['email', 'password'],
  showPasswordStrength = true,
  respectRegistrationPolicy = true,
  unavailable,
  socialProviders,
  className,
}: RegisterFormProps) {
  const { register, isLoading, error } = useAuth();
  const authConfig = useAuthConfig();
  const [form, setForm] = React.useState({
    email: '',
    username: '',
    firstName: '',
    lastName: '',
    password: '',
  });
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [usernameFocused, setUsernameFocused] = React.useState(false);

  const displayError = localError ?? error;
  const hasNames = fields.includes('firstName') || fields.includes('lastName');
  const configPending = isAuthConfigPending(respectRegistrationPolicy, authConfig);
  const configUnavailable = isAuthConfigUnavailable(respectRegistrationPolicy, authConfig);
  const registrationClosed = isRegistrationClosed(respectRegistrationPolicy, authConfig);

  function update(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    try {
      await register({
        email: form.email,
        username: form.username || form.email,
        password: form.password,
        ...(form.firstName ? { firstName: form.firstName } : {}),
        ...(form.lastName ? { lastName: form.lastName } : {}),
      });
      onSuccess?.();
    } catch (err) {
      reportAuthUiError('register', err);
      setLocalError(getAuthDisplayMessage(err, 'Registration failed'));
    }
  }

  if (configPending) {
    return <RegistrationPolicyLoading />;
  }

  if (configUnavailable) {
    return <>{unavailable ?? <RegistrationConfigUnavailable loginHref={loginHref} showLoginLink={showLoginLink} />}</>;
  }

  if (registrationClosed) {
    return <>{unavailable ?? <RegistrationUnavailable loginHref={loginHref} showLoginLink={showLoginLink} />}</>;
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-3', className)}>
      <AuthHeader
        title={authConfig.bootstrapRequired ? 'Create first admin' : 'Create account'}
        description={authConfig.bootstrapRequired ? 'The first account becomes the app admin' : 'Enter your details to get started'}
      />

      <div className="space-y-3">
        {hasNames && (
          <div className="grid grid-cols-2 gap-3">
            {fields.includes('firstName') && (
              <div className="space-y-1.5">
                <Label htmlFor="reg-first" className="text-sm font-medium">First name</Label>
                <Input
                  id="reg-first"
                  placeholder="First name"
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={update('firstName')}
                  className="h-8 text-sm"
                />
              </div>
            )}
            {fields.includes('lastName') && (
              <div className="space-y-1.5">
                <Label htmlFor="reg-last" className="text-sm font-medium">Last name</Label>
                <Input
                  id="reg-last"
                  placeholder="Last name"
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={update('lastName')}
                  className="h-8 text-sm"
                />
              </div>
            )}
          </div>
        )}

        {fields.includes('email') && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-email" className="text-sm font-medium">Email</Label>
            <Input
              id="reg-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={form.email}
              onChange={update('email')}
              className={cn('h-8 text-sm', displayError && 'border-destructive/50 focus-visible:ring-destructive/30')}
            />
          </div>
        )}

        {fields.includes('username') && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-username" className="text-sm font-medium">Username</Label>
            <Input
              id="reg-username"
              placeholder="username"
              autoComplete="username"
              required
              value={form.username}
              onChange={update('username')}
              onFocus={() => setUsernameFocused(true)}
              onBlur={() => setUsernameFocused(false)}
              className="h-8 text-sm"
            />
            {(usernameFocused || form.username.length > 0) && (
              <ValidationRules
                rules={getUsernameRules(form.username)}
                staggerDelay={40}
                showOnlyWhenActive={false}
              />
            )}
          </div>
        )}

        {fields.includes('password') && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-password" className="text-sm font-medium">Password</Label>
            <PasswordInput
              id="reg-password"
              placeholder="Create a password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={update('password')}
              showStrength={showPasswordStrength}
              className={cn('h-8 text-sm', displayError && 'border-destructive/50 focus-visible:ring-destructive/30')}
            />
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

      <Button type="submit" size="sm" className="w-full h-8" disabled={isLoading || configPending}>
        {isLoading ? (
          <AnimateIcon animate loop>
            <Loader size={16} />
          </AnimateIcon>
        ) : (
          'Create account'
        )}
      </Button>

      {socialProviders && socialProviders.length > 0 && (
        <SocialLoginGroup providers={socialProviders} />
      )}

      {showLoginLink && (
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href={loginHref} className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      )}
    </form>
  );
}

function RegistrationPolicyLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" aria-live="polite">
      <AnimateIcon animate loop>
        <Loader size={16} />
      </AnimateIcon>
      Loading registration settings
    </div>
  );
}

function RegistrationConfigUnavailable({
  loginHref,
  showLoginLink,
}: {
  loginHref: string;
  showLoginLink: boolean;
}) {
  return (
    <div className="space-y-3">
      <AuthHeader title="Registration unavailable" description="Registration settings could not be loaded." />
      {showLoginLink && (
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href={loginHref} className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      )}
    </div>
  );
}

function RegistrationUnavailable({
  loginHref,
  showLoginLink,
}: {
  loginHref: string;
  showLoginLink: boolean;
}) {
  return (
    <div className="space-y-3">
      <AuthHeader title="Registration closed" description="An administrator must create new accounts for this app." />
      {showLoginLink && (
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <a href={loginHref} className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      )}
    </div>
  );
}

export { RegisterForm, type RegisterFormProps };
