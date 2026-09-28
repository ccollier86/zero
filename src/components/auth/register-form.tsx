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

import { cn } from '#zero/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { PasswordInput } from '#zero/components/auth/password-input';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AuthFlowContinuation } from '#zero/components/auth/auth-flow-continuation';
import { SocialLoginGroup, type SocialProvider } from '#zero/components/auth/social-login-group';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { Send } from '#zero/components/animate-ui/icons/send';
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
import {
  type AuthFlowContinuationResult,
  isAuthFlowContinuationResult,
} from './auth-continuation';
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
    bootstrapSecret: '',
    organizationName: '',
  });
  const [localError, setLocalError] = React.useState<string | null>(null);
  const loginHint = useNativeLoginHint();
  const nativeContinuation = useNativeAuthContinuation();
  const [pendingVerificationEmail, setPendingVerificationEmail] = React.useState<string | null>(null);
  const [resendingVerification, setResendingVerification] = React.useState(false);
  const [verificationResent, setVerificationResent] = React.useState(false);
  const [requestMfaEnrollment, setRequestMfaEnrollment] = React.useState(false);
  const [createTenantOnRegistration, setCreateTenantOnRegistration] = React.useState(false);
  const [authContinuation, setAuthContinuation] = React.useState<
    AuthFlowContinuationResult | null
  >(null);

  const displayError = localError ?? error;
  const hasNames = fields.includes('firstName') || fields.includes('lastName');
  const configPending = isAuthConfigPending(respectRegistrationPolicy, authConfig);
  const configUnavailable = isAuthConfigUnavailable(respectRegistrationPolicy, authConfig);
  const registrationClosed = isRegistrationClosed(respectRegistrationPolicy, authConfig);
  const isMultiTenant = authConfig.config?.tenancy?.mode === 'multi';
  const tenantTerm = authConfig.config?.tenancy?.terminology?.singular ?? 'organization';
  const requiresBootstrapTenant = isMultiTenant && authConfig.bootstrapRequired;
  // Older multi-tenant servers exposed only `{ mode: 'multi' }` and required
  // organization input on every registration. Preserve that wire contract.
  const legacyRequiresTenant = Boolean(
    isMultiTenant
    && !authConfig.bootstrapRequired
    && authConfig.config?.tenancy?.creation === undefined
  );
  const canOfferTenantCreation = Boolean(
    isMultiTenant
    && !authConfig.bootstrapRequired
    && authConfig.config?.tenancy?.creation?.mode === 'authenticated'
  );
  const shouldCreateTenant = requiresBootstrapTenant || legacyRequiresTenant
    || (canOfferTenantCreation && createTenantOnRegistration);
  const mfaConfig = authConfig.config?.mfa;
  const bootstrapSecretRequired = Boolean(
    authConfig.bootstrapRequired
    && authConfig.config?.bootstrap?.secretRequired
  );
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
        ...(shouldCreateTenant ? { organizationName: form.organizationName } : {}),
        ...(bootstrapSecretRequired
          ? { bootstrapSecret: form.bootstrapSecret }
          : {}),
      });
      const user = result?.user;
      if (user?.emailVerificationRequired && !user.emailVerifiedAt) {
        setPendingVerificationEmail(user.email);
        return;
      }
      if (isAuthFlowContinuationResult(result)) {
        setAuthContinuation(result);
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

  if (authContinuation) {
    return (
      <AuthFlowContinuation
        result={authContinuation}
        onSuccess={onSuccess}
        onBack={() => setAuthContinuation(null)}
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

        <div className="flex items-start gap-2 rounded-md border border-success/35 bg-success/10 px-3 py-2.5 text-sm text-foreground dark:border-success/45 dark:bg-success/15">
          <AnimateIcon animate>
            <CircleCheck size={16} className="mt-px flex-shrink-0 text-success" />
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
    <form
      onSubmit={handleSubmit}
      className={cn('space-y-4', className)}
      aria-busy={isLoading}
    >
      <AuthHeader
        title={authConfig.bootstrapRequired
          ? isMultiTenant ? `Create your ${tenantTerm}` : 'Create first admin'
          : 'Create account'}
        description={authConfig.bootstrapRequired
          ? bootstrapSecretRequired
            ? isMultiTenant
              ? `Enter the operator setup key to create the first administrator and ${tenantTerm}.`
              : 'Enter the operator setup key to create the first administrator.'
            : isMultiTenant
              ? `The first account becomes the app administrator and ${tenantTerm} owner.`
              : 'The first account becomes the app administrator.'
          : isMultiTenant
            ? `Create your identity, then create a new ${tenantTerm} or join an existing one.`
            : 'Enter your details to get started'}
      />

      <div className="space-y-4">
        {canOfferTenantCreation && (
          <div className="flex items-start gap-2 rounded-md border border-border/75 bg-muted/25 p-3">
            <Checkbox
              id="reg-create-tenant"
              size="sm"
              checked={createTenantOnRegistration}
              onCheckedChange={(value) => setCreateTenantOnRegistration(value === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="reg-create-tenant"
              className="cursor-pointer text-xs font-normal leading-relaxed text-muted-foreground"
            >
              Create a new {tenantTerm} that I will own.
            </Label>
          </div>
        )}

        {shouldCreateTenant && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-organization" className="text-sm font-medium">
              {capitalize(tenantTerm)} name
            </Label>
            <Input
              id="reg-organization"
              placeholder="Acme, Inc."
              autoComplete="organization"
              required={requiresBootstrapTenant || legacyRequiresTenant || createTenantOnRegistration}
              value={form.organizationName}
              onChange={update('organizationName')}
              className={cn('h-10 text-sm', displayError && 'ring-[1px] ring-destructive/30')}
            />
          </div>
        )}

        {hasNames && (
          <div className="grid gap-3 sm:grid-cols-2">
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

        {bootstrapSecretRequired && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-bootstrap-secret" className="text-sm font-medium">
              Operator setup key
            </Label>
            <Input
              id="reg-bootstrap-secret"
              type="password"
              placeholder="Bootstrap secret"
              autoComplete="off"
              required
              value={form.bootstrapSecret}
              onChange={update('bootstrapSecret')}
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
          <>
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            <span className="sr-only">Creating account</span>
          </>
        ) : (
          authConfig.bootstrapRequired
            ? isMultiTenant ? `Create ${tenantTerm}` : 'Create administrator'
            : shouldCreateTenant ? `Create account and ${tenantTerm}` : 'Create account'
        )}
      </Button>

      {!authConfig.bootstrapRequired && socialProviders && socialProviders.length > 0 && (
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

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
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
      <AuthHeader
        title="Registration closed"
        description="An administrator or deployment operator must enable account creation for this app."
      />
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
