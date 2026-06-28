/**
 * runtime.ts
 *
 * Owns Zero's process-wide email runtime. createApp configures this boundary;
 * auth/account lifecycle services read from it without knowing provider setup.
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

let runtime: EmailRuntime = createEmailRuntime(undefined, {});

/**
 * Configure the active process-wide email runtime.
 *
 * Passing `false` disables delivery. Passing `true` uses Resend defaults.
 * Passing a custom provider object keeps Zero's auth email code provider-agnostic.
 */
export function configureEmail(
  config: EmailConfig | boolean | false | undefined,
  app: AppIdentityConfig = {}
): EmailRuntime {
  runtime = createEmailRuntime(config, app);
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

/** Return the active email runtime. */
export function getEmailRuntime(): EmailRuntime {
  return runtime;
}

/** Return the active email service. */
export function getEmailService(): EmailService {
  return runtime.service as EmailService;
}

function createEmailRuntime(
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

  const config: EmailConfig = input === true ? {} : input;
  const provider = resolveProvider(config);

  return {
    enabled: provider.name !== 'noop',
    app,
    config,
    provider,
    service: new EmailService(provider, config),
  };
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
