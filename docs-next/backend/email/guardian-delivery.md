---
id: zero.email.guardian-delivery
type: architecture
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: guardian-message-integration
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [guardian-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian's Email Delivery Boundary

[Email index](./index.md) · [Documentation index](../../index.md)

Guardian decides whether an identity/security action is allowed and generates
its exact token/template. EmailService delivers the resulting message. Do not
replace a password-reset route with an app-owned mail containing a guessed
token or directly alter users to simulate verification.

## Relevant Ceremonies

| Feature | Authoritative guide |
| --- | --- |
| Registration verification/resend | [Email verification](../guardian/email-verification.md). |
| Password reset/setup/change | [Recovery](../guardian/password-recovery.md) and [account administration](../guardian/accounts.md). |
| Email MFA enrollment/challenge | [MFA](../guardian/mfa.md). |
| Organization invitation delivery | [Invitations](../guardian/invitations.md). |
| Verified-domain mailbox proof | [Verified domains](../guardian/verified-domains.md). |

Those guides own enablement, address normalization, token binding, privacy,
expiry and acceptance results. Public reset/resend/domain requests deliberately
avoid disclosing whether an account/organization is eligible. An accepted
acknowledgment does not prove a mail was sent or a membership was granted.

## App Identity And Links

Configure the real public application origin in AppIdentityConfig rather than
building action links from an untrusted request Host or arbitrary browser URL.
Use the configured action paths and native continuation handling. Keep sender
and delivery readiness aligned with any Guardian mode that requires email.
Public policy reports safe capabilities, not credentials or raw action tokens.

Durable queued delivery covers the specific four outbox kinds documented in
[outbox](./outbox.md). Some privileged admin/security sends and OTP attempts
have their own exact-state compensation rather than generic outbox semantics.
Do not promise that every email-like operation is queued/replayed identically.

## Failure And Privacy

Account delivery errors remain Guardian/domain outcomes. Provider failure
events use safe failure classifications and cleanup/postcondition fields,
not rendered mail or action URLs. The console adapter intentionally does not
print tokens; use a controlled MemoryEmailProvider fixture to inspect a
synthetic ceremony in a test.

Compensation only undoes the exact untouched provisional state belonging to
the failed attempt. Newer account or authority changes must be retained.
Expected public acknowledgments remain private even when an internal delivery
attempt fails; operators diagnose through the app-local event stream.

## Verification And Related Guides

Exercise ready/unready email, allowed/denied ceremonies, exact address/token
mismatch, expiry, provider rejection and surrounding transaction rollback.
Use synthetic accounts and an in-memory provider, not real delivery recipients.

- [Configuration](./configuration.md) owns minimum captured readiness.
- [Outbox](./outbox.md) explains durable jobs versus synchronous compensation.
- [Guardian errors](../guardian/errors.md) owns safe protocol responses.
