/**
 * runtime.ts
 *
 * Builds app-local email runtimes and retains a guarded compatibility boundary
 * for older integrations that use no-argument getters.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { ConsoleEmailProvider } from './console-email-provider';
import { EmailService } from './email-service';
import { MemoryEmailProvider } from './memory-email-provider';
import { NoopEmailProvider } from './noop-email-provider';
import { ResendEmailProvider } from './resend-email-provider';
import type {
  AppIdentityConfig,
  BuiltInEmailProvider,
  EmailConfig,
  EmailProvider,
  EmailRuntime,
} from './types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';

const emailRuntimeProviders = new CompatibilityProviderRegistry<EmailRuntime>(
  'Email runtime',
);
const manualOwner = {};
const disabledRuntime = createEmailRuntime(undefined, {});
let manualRegistration: ReturnType<typeof emailRuntimeProviders.register> | null = null;

/**
 * Configure the manual compatibility email runtime.
 *
 * Passing `false` disables delivery. Passing `true` uses Resend defaults.
 * Passing a custom provider object keeps Zero's auth email code provider-agnostic.
 */
export function configureEmail(
  config: EmailConfig | boolean | false | undefined,
  app: AppIdentityConfig = {}
): EmailRuntime {
  const runtime = createEmailRuntime(config, app);
  manualRegistration?.unregister();
  manualRegistration = emailRuntimeProviders.register(manualOwner, () => runtime);
  emitPlatformCode(OBS_CODES.EMAIL_CONFIGURED, {
    metadata: {
      enabled: runtime.enabled,
      provider: runtime.provider.name,
      appName: runtime.app.name,
      hasPublicUrl: Boolean(runtime.app.publicUrl),
    },
  });
  return runtime;
}

/** Return the only unambiguous compatibility email runtime. */
export function getEmailRuntime(): EmailRuntime {
  return emailRuntimeProviders.get() ?? disabledRuntime;
}

/** Return the only unambiguous compatibility email service. */
export function getEmailService(): EmailService {
  return getEmailRuntime().service as EmailService;
}

/**
 * Whether the active email boundary has the minimum configuration required to
 * attempt delivery. Public action-link flows must additionally require an app
 * public URL.
 */
export function isEmailDeliveryReady(
  candidate: EmailRuntime = getEmailRuntime()
): boolean {
  if (!candidate.enabled || !candidate.config) {
    return false;
  }

  const config = candidate.config;
  if (!config.from?.trim()) return false;

  // Custom providers own their credential/readiness contract. The built-in
  // Resend adapter can be checked without exposing its secret.
  if (typeof config.provider === 'object') return true;
  const provider = config.provider ?? 'resend';
  if (provider === 'resend') {
    return Boolean(config.resend?.apiKey?.trim() || Bun.env.RESEND_API_KEY?.trim());
  }

  return provider !== 'noop';
}

export function createEmailRuntime(
  input: EmailConfig | boolean | false | undefined,
  app: AppIdentityConfig
): EmailRuntime {
  if (input === false || input === undefined) {
    const provider = new NoopEmailProvider();
    return {
      enabled: false,
      app,
      config: input,
      provider,
      service: new EmailService(provider, {}),
    };
  }

  const configured: EmailConfig = input === true ? {} : input;
  const config: EmailConfig = {
    ...configured,
    from: firstNonEmpty(configured.from) ?? firstNonEmpty(Bun.env.EMAIL_FROM),
    replyTo: firstNonEmpty(configured.replyTo) ?? firstNonEmpty(Bun.env.EMAIL_REPLY_TO),
  };
  const provider = resolveProvider(config);

  return {
    enabled: provider.name !== 'noop',
    app,
    config,
    provider,
    service: new EmailService(provider, config),
  };
}

/** Register one app-local email runtime for legacy no-argument compatibility. */
export function registerEmailRuntime(owner: object, runtime: EmailRuntime): {
  unregister(): void;
} {
  return emailRuntimeProviders.register(owner, () => runtime);
}

function firstNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveProvider(config: EmailConfig): EmailProvider {
  const provider = config.provider ?? 'resend';
  if (typeof provider === 'object') return provider;

  switch (provider as BuiltInEmailProvider) {
    case 'resend':
      return new ResendEmailProvider(config.resend);
    case 'console':
      return new ConsoleEmailProvider();
    case 'memory':
      return new MemoryEmailProvider();
    case 'noop':
      return new NoopEmailProvider();
  }
}
