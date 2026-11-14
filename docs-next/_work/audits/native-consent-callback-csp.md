---
id: zero.audit.native-consent-callback-csp
type: operations
audience: [agent, maintainer, operator]
owner: guardian
status: in-review
visibility: internal
---

# Native Consent Callback CSP Qualification

[Native provider guide](../../backend/guardian/native-provider.md)
· [Saved release operations](../../cli/tooling/releases.md)

## Report And Scope

The Android operator application's November 13 handoff reproduces against Zero
2.10.3, commit `ebad01dc8e351c26ae9ec23547169fffd430f3a7`. Consent approval consumes
the request and issues a normal redirect, but Chromium rejects its private-scheme
callback under `form-action 'self'`. This is a different boundary from the
previous raw form-body and consent-Origin repairs.

Zero 2.10.4 adds only the selected registered request's private scheme or exact
network origin to the consent HTML policy. Error pages remain self-only. The
redirect helper, Origin check, registration matching, PKCE, state/nonce,
single-use proofs and live Guardian permissions are not weakened. No database
migration, account/session rewrite or dependency change is introduced.

The browser policy deliberately excludes path/query values. They may contain
policy delimiters, and CSP ignores source path restrictions on redirects. Exact
registered path/query enforcement remains the protocol's responsibility.
See [CSP3](https://www.w3.org/TR/CSP3/#directive-form-action).

## Focused Qualification

The focused source pass completed with **43 tests / 501 assertions across six
files**, all passing, followed by a successful project TypeScript check. Seven
of these are actual Chromium cases (97 assertions), including the negative
control. Exact committed-package evidence is separate and recorded below the
release boundary in the external qualification receipt; these counts overlap.

- Native HTTP tests verify custom schemes, HTTPS/port/loopback sources, unchanged
  hardening headers, injection-resistant serialization and static safe rejection
  of invalid callback values.
- Real managed Chromium tests click Continue/Cancel for same-origin, private
  scheme and cross-origin HTTPS returns. They observe the callback request,
  check browser-issued Origin/no-referrer behavior, exchange approved codes and
  verify selected-only policy sources. A synthetic old-policy negative control
  must fail at the CSP boundary after the actual approval POST.
- The HTTPS callback is fulfilled at Chromium's request boundary for a reserved
  `.test` host; no provider or remote callback service is used. Custom-scheme
  tests prove a browser callback attempt, not OS handler installation.
- Existing native managed-form, authorization, redirect and disclosure tests
  retain rejection, ownership, replay and proof coverage. TypeScript and final
  exact-archive checks are recorded in the bounded qualification receipt.

Browser diagnostics retain only static flags/codes, not callback URLs, request
IDs, PKCE values, tokens or credentials. Fixtures stop owned apps/contexts and
verify their synthetic marker/root identity before cleanup; no real runtime
database or Android application state is accessed.

Source and exact package evidence live under
`artifacts/zero-platform/diagnostics/native-consent-csp` on the external volume.
The final receipt/handoff identifies commit, archive path, SHA, executed gates
and updater selection. Initial failures in the observation harness are kept
separate from passing final qualification, not relabeled as framework passes.

## Application Acceptance

The application agent should apply the normal saved update, rebuild the managed
server, repeat its owned upgrade checks and start a fresh native authorization.
Previously consumed requests must remain unusable. Verify the real device's
return-to-app, token exchange, retry ownership and retained sign-in after app
restart. Existing accounts, customer/operator keys and native sessions must be
preserved. Zero's source/macOS browser checks are not an Android-device or
production-deployment claim. No Stupify source or production changes are made
by this framework repair.
