---
id: zero.configuration.app-identity
type: reference
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: app-identity
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# App Identity And Public Origins

[Configuration index](./index.md) · [Documentation index](../../index.md)

`AppConfig.app` accepts `name`, `publicUrl` and `supportEmail`.
They are optional strings. The top-level resolver uses {} when omitted; it
does not invent an organization, create permissions or supply provider credentials.

```ts
// AppConfig fragment
app: {
  name: 'Example Workspace',
  publicUrl: 'https://app.example.test',
  supportEmail: 'support@example.test',
}
```

Use a server-reviewed deployment origin, not an incoming request's arbitrary
Host header, for public action links. This fragment does not configure email
delivery by itself.

## Option Meaning

| Path | Purpose |
| --- | --- |
| `app.name` | human-readable application identity used in system/email copy |
| `app.publicUrl` | public origin for action links and sitemap URL generation |
| `app.supportEmail` | optional support/reply identity for appropriate consumers |

Consumers resolve their own fallback behavior; no global name/address default
is established by the top-level app resolver. Sender/replyTo/provider credentials
belong to the email configuration, not these identity fields.

## Read Time And Safety

These are server startup declaration values. An enabled email runtime retains
the supplied app identity; mutating a different config file later does not
automatically update a running service. The containing app should restart/rebind
according to normal deployment behavior.

The public origin/name are intentionally displayable where a feature projects
them, but never serialize the entire app config because these three fields happen
to be public. Adjacent AI keys, actor environment and signing policy can be secret.

## Verification

In synthetic fixtures, check the actual destination of account links and sitemap
URLs. Ensure deployment configuration uses the intended public origin and does
not accidentally generate localhost/preview links for production mail.

Keep private credentials out of captured message metadata. An app name is not
a tenant ID, and a support email is not a domain ownership proof.

## Related Guides And Next Steps

- [Feature switches](./feature-switches.md) separates enabled email from delivery readiness.
- [Routing](./routing.md) controls local login/registration destinations.
- [Sitemap](./sitemap.md) uses the configured public origin for emitted URLs.
- [Guardian](../guardian/index.md) owns verified-domain onboarding and account actions.
- [Reference](./configuration.md) identifies the separate navigation settings.
