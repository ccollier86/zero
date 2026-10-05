---
id: zero.email.configuration
type: reference
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: runtime-configuration
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Email Configuration And Runtime Ownership

[Email index](./index.md) · [Documentation index](../../index.md)

Set `createApp({ email: ... })`; omitted/false disables managed delivery,
`true` chooses Resend defaults, and an object selects/configures a provider.
Readiness is resolved against the app-local captured runtime, not a browser
setting or an ambient getter from whichever app started most recently.

## Exact Configuration

| Path | Accepted value / default / resolution |
| --- | --- |
| `email` | `boolean | EmailConfig`; omitted/false produces disabled Noop runtime. True is an empty EmailConfig. |
| `email.provider` | Built-in name or EmailProvider object; default Resend. A noop-named adapter marks the runtime disabled. |
| `email.from` | Optional string. Trimmed first nonblank explicit value, otherwise trimmed nonblank `EMAIL_FROM`. |
| `email.replyTo` | Optional string. Same nonblank precedence over `EMAIL_REPLY_TO`. |
| `email.resend.apiKey` | Optional string. Explicit value by `??`, otherwise `RESEND_API_KEY`; explicit empty/whitespace is not fallback. |
| `email.resend.baseUrl` | Optional string; default `https://api.resend.com`. Trusted server configuration, not a tenant-controlled URL. |
| `app.name/publicUrl/supportEmail` | AppIdentityConfig, separate from email; used by Guardian template/link composition. |

Values are captured at runtime/provider construction. Environment mutation is
not supported hot configuration. Recreate the owning runtime/restart through
the normal lifecycle when changing credentials. Message-level sender/replyTo
overrides use the send contract, not runtime env resolution.

The key-readiness correction in this development tree is important: readiness
checks the actual captured Resend adapter credential, including explicit empty
keys, rather than recomputing an unrelated env fallback.

## Minimum Readiness Versus Real Delivery

`isEmailDeliveryReady(runtime?)` requires enabled config and nonblank sender.
Resend additionally requires its captured nonblank key. Custom provider objects
are treated as ready after sender admission; console/memory are ready for their
local semantics, not production mailbox delivery; noop is not ready.
Guardian public action links also require a valid configured public app URL.
Readiness is not a network probe or verified sender/domain certification.

Use Doctor's Guardian email checks for policy combinations requiring delivery;
Doctor imports trusted config and is not a no-side-effect static inspector.
No environment contents or real providers are needed for documentation tests.

## Standalone And Compatibility APIs

`createEmailRuntime(config, app, emitCode?)` returns an unregistered local
runtime. Inject the returned service directly. The optional emitter binds
operational events to the intended app/adapter.

`registerEmailRuntime(owner, runtime)` returns an `unregister()` handle for
legacy no-argument compatibility. `configureEmail(config, app?)` replaces the
manual compatibility registration. `getEmailRuntime()` and
`getEmailService()` resolve only an unambiguous registered runtime, or the
disabled fallback when none exists. Multiple app registrations are not a
"last one wins" routing policy. Always unregister the exact ownership handle.

Managed services receive their own email runtime/emitter; using a process-wide
compatibility getter in a multi-app process forfeits that explicit dependency
selection. Server secrets are never projected by the frontend configuration.

## Verification And Related Guides

Test omitted/false/true/object, missing sender, explicit empty key and an env
change after construction using fresh runtimes and synthetic values. Verify
two app-local providers receive only their own synthetic sends.

- [Service](./service.md) defines per-message validation/override behavior.
- [Guardian delivery](./guardian-delivery.md) adds public-link readiness.
- [Runtime services](../runtime/server-services.md) explains managed injection.
