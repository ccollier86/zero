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
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/animate-ui/components/radix/checkbox';
import { PasswordInput } from '@/components/auth/password-input';
import { AuthHeader } from '@/components/auth/auth-header';
import { MFAContinuation } from '@/components/auth/mfa-continuation';
import { SocialLoginGroup, type SocialProvider } from '@/components/auth/social-login-group';
import type {
  AuthMfaChallengeRequiredResult,
  AuthMfaSetupRequiredResult,
} from '../../frontend/client/auth-client';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleCheck } from '@/components/animate-ui/icons/circle-check';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';
import { Send } from '@/components/animate-ui/icons/send';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import {
  isAuthConfigPending,
  isAuthConfigUnavailable,
  isRegistrationClosed,
} from './auth-config-ui-policy';
import {
  authFeedbackAnimate,
  authFeedbackExit,
  authFeedbackInitial,
  authPresenceTransition,
} from './auth-motion';
import { isMfaContinuationResult } from './auth-continuation';
import {
  useNativeAuthContinuation,
  useNativeAuthRoute,
  useNativeLoginHint,
} from './use-native-auth-route';

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
  const { register, resendVerificationEmail, isLoading, error } = useAuth();
  const authConfig = useAuthConfig();
  const [form, setForm] = React.useState({
    email: '',
    username: '',
    firstName: '',
    lastName: '',
    password: '',
  });
  const [localError, setLocalError] = React.useState<string | null>(null);
  const loginHint = useNativeLoginHint();
  const nativeContinuation = useNativeAuthContinuation();
  const [pendingVerificationEmail, setPendingVerificationEmail] = React.useState<string | null>(null);
  const [resendingVerification, setResendingVerification] = React.useState(false);
  const [verificationResent, setVerificationResent] = React.useState(false);
  const [requestMfaEnrollment, setRequestMfaEnrollment] = React.useState(false);
  const [mfaContinuation, setMfaContinuation] = React.useState<
    AuthMfaSetupRequiredResult | AuthMfaChallengeRequiredResult | null
  >(null);

  const displayError = localError ?? error;
  const hasNames = fields.includes('firstName') || fields.includes('lastName');
  const configPending = isAuthConfigPending(respectRegistrationPolicy, authConfig);
  const configUnavailable = isAuthConfigUnavailable(respectRegistrationPolicy, authConfig);
  const registrationClosed = isRegistrationClosed(respectRegistrationPolicy, authConfig);
  const mfaConfig = authConfig.config?.mfa;
  const canRequestOptionalMfa =
    Boolean(mfaConfig?.enabled && mfaConfig.ready) &&
    mfaConfig?.policy === 'optional' &&
    (mfaConfig.availableMethods.length > 0 || mfaConfig.methods.length > 0);
  const continuedLoginHref = useNativeAuthRoute(loginHref);

  React.useEffect(() => {
    if (loginHint) setForm((current) => ({
      ...current,
      email: current.email || loginHint,
      username: current.username || loginHint,
    }));
  }, [loginHint]);

  function update(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setVerificationResent(false);
    try {
      const result = await register({
        email: form.email,
        username: form.username || form.email,
        password: form.password,
        ...(form.firstName ? { firstName: form.firstName } : {}),
        ...(form.lastName ? { lastName: form.lastName } : {}),
        ...(canRequestOptionalMfa && requestMfaEnrollment ? { mfaEnrollment: true } : {}),
        ...(nativeContinuation ? { nativeContinuation } : {}),
      });
      if (isMfaContinuationResult(result)) {
        setMfaContinuation(result);
        return;
      }
      const user = result?.user;
      if (user?.emailVerificationRequired && !user.emailVerifiedAt) {
        setPendingVerificationEmail(user.email);
        return;
      }
      onSuccess?.();
    } catch (err) {
      reportAuthUiError('register', err);
      setLocalError(getAuthDisplayMessage(err, 'Registration failed'));
    }
  }

  async function handleResendVerification() {
    if (!pendingVerificationEmail || resendingVerification) return;
    setResendingVerification(true);
    setVerificationResent(false);
    setLocalError(null);
    try {
      await resendVerificationEmail(pendingVerificationEmail, nativeContinuation ?? undefined);
      setVerificationResent(true);
    } catch (err) {
      reportAuthUiError('resendVerificationEmail', err);
      setLocalError(getAuthDisplayMessage(err, 'Failed to request verification email'));
    } finally {
      setResendingVerification(false);
    }
  }

  if (configPending) {
    return <RegistrationPolicyLoading />;
  }

  if (configUnavailable) {
    return <>{unavailable ?? <RegistrationConfigUnavailable loginHref={continuedLoginHref} showLoginLink={showLoginLink} />}</>;
  }

  if (registrationClosed) {
    return <>{unavailable ?? <RegistrationUnavailable loginHref={continuedLoginHref} showLoginLink={showLoginLink} />}</>;
  }

  if (mfaContinuation) {
    return (
      <MFAContinuation
        result={mfaContinuation}
        onSuccess={onSuccess}
        onBack={() => setMfaContinuation(null)}
        className={className}
      />
    );
  }

  if (pendingVerificationEmail) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title="Check your email"
          description={`We sent a verification link to ${pendingVerificationEmail}.`}
        />

        <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2.5 text-sm text-green-600">
          <AnimateIcon animate>
            <CircleCheck size={16} className="mt-px flex-shrink-0" />
          </AnimateIcon>
          Verify your email before signing in.
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

        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          disabled={resendingVerification}
          onClick={handleResendVerification}
        >
          {resendingVerification ? (
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
          ) : (
            <AnimateIcon animateOnHover>
              <Send size={16} />
            </AnimateIcon>
          )}
          Send another link
        </Button>

        {verificationResent && (
          <p className="text-center text-xs text-muted-foreground">
            If the account still needs verification, a new link was sent.
          </p>
        )}

        <a href={continuedLoginHref} className="block text-center text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
      <AuthHeader
        title={authConfig.bootstrapRequired ? 'Create first admin' : 'Create account'}
        description={authConfig.bootstrapRequired ? 'The first account becomes the app admin' : 'Enter your details to get started'}
      />

      <div className="space-y-4">
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
                  className="h-10 text-sm"
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
                  className="h-10 text-sm"
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
              className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
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
              className="h-10 text-sm"
            />
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
              className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
            />
          </div>
        )}

        {canRequestOptionalMfa && (
          <div className="flex items-start gap-2 rounded-md border border-border/75 bg-muted/25 p-3">
            <Checkbox
              id="reg-mfa-enrollment"
              size="sm"
              checked={requestMfaEnrollment}
              onCheckedChange={(value) => setRequestMfaEnrollment(value === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="reg-mfa-enrollment"
              className="cursor-pointer text-xs font-normal leading-relaxed text-muted-foreground"
            >
              Set up two-factor authentication after account creation.
            </Label>
          </div>
        )}
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

      <Button type="submit" className="h-10 w-full" disabled={isLoading || configPending}>
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
          <a href={continuedLoginHref} className="text-primary hover:underline">
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
