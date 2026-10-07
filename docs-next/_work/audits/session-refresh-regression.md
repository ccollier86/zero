---
id: zero.audit.session-refresh-regression
type: operations
audience: [agent, maintainer]
owner: guardian
status: verified
visibility: internal
---

# Page Session And Browser Recovery Regression

[Audit index](./index.md) · [Guardian sessions](../../backend/guardian/sessions.md)
· [Scope transitions](../../frontend/runtime/scope-transitions.md)
· [Documentation index](../../index.md)

## Scope And Evidence Boundary

This investigation starts from framework 2.6.0, committed main
`1030f7f40d1ba44da89df86bb697d6aea5b60e42`, on October 7, 2026.
The DataTable motion update was merged and pushed at that checkpoint before
this separate authentication correction began. The user authorized investigation,
reproduction, correction and a separate main merge.

The reported production symptoms were a recovery screen during hard refresh or
ordinary authenticated use, often followed by successful automatic sign-in,
and earlier failures that required manual cookie clearing. The defects below
were reproduced using synthetic identities, isolated browser/storage fixtures
and local HTTP services. No live application account, cookie, environment
secret, database, deployment or provider was inspected or changed. These
reproductions establish framework defects, not the precise timing of every
reported production incident.

## Confirmed Defects And Corrections

### Authorization Loading Misclassified As Session Disagreement

After a server-declared Sync read-authority purge, the SDK invalidates the
authorization hint and advances its local data fence. That correctly hides
unsafe cached data while the replacement projection loads. AppProvider also
treated `!boundary.ready` as sufficient reason for `recoverSession()` and
document reload, even with unchanged user, organization, family and page
authority. Readiness and credential validity are different contracts.

The correction waits behind the existing data boundary without rotating proof.
Unchanged authority resumes the existing page. A temporary failed recheck offers
an access-only retry with safe presentation and code-only observability. A
genuine same-identity authority revision change reloads stale SSR loader data
without unnecessary credential restoration. Strict identity, role, tenant and
revision comparisons remain in place.

### Routine Automatic Repair Displayed As An Error

The guard displayed `Session refresh required` as soon as its first automatic
repair started. A successful normal repair therefore looked like a failed
session. First-attempt repair now uses a neutral accessible status; failed or
persistent recovery retains bounded explicit Retry and Sign out. This is not a
license to render loader data while the page boundary disagrees.

### Constructor Identity Lookup Raced Legal Peer Rotation

Constructor restoration held the cross-tab credential lock for refresh but
released it before `/auth/me`. Another tab could rotate the same valid family
while that response was pending. The exact local/durable revision fence then
correctly discarded the lookup, but restoration settled without a user and
triggered recovery despite retaining valid proof.

Startup refresh and identity hydration now share one bounded credential
operation. The denied-identity cleanup runs inside that operation, avoiding
non-reentrant lock reacquisition. Logout, disposal, uncoordinated replacement
and exact credential-revision fences still reject late results.

Definitive authorization rejection also owns bounded page-cookie logout in the
SDK lifecycle, before publishing a completed signed-out scope. It does not
depend on a page guard guessing whether a cookie used to exist. Explicit
recovery retains its existing cleanup owner rather than adding duplicate
writers. Remote cleanup acknowledgement remains distinct from local retirement
when the server is unreachable.

Avoiding duplicate page-cookie logout uses a core receipt for the exact current
anonymous credential revision and an acknowledged server response. It is not
inferred from a previously displayed account, an error string or a cleared local
user. A new local/durable family, revision or disposal invalidates that receipt.

### Page Cookie Bound To One-Use Refresh Child

Page JWTs were bound to the refresh child ID. A successful refresh revoked that
child while retaining its durable parent, making an otherwise normal concurrent
document request fail page admission. New explicitly versioned page proofs bind
to the durable web parent, its generation and user security generation. Live
parent/account/tenant/membership/MFA checks and signed expiry remain mandatory.
Legacy child proofs still require their exact live child; revoked children are
not generically admitted. Both formats require a signed, supported whole-second
expiration; missing/malformed expiry, unknown versions and invalid generations
fail closed.

### Delayed Document Response Could Erase New Cookie

A rejected safe document emitted a deletion for the canonical cookie name. If
that response arrived after refresh or a new login, the browser erased the new
valid cookie. `Set-Cookie` has no value compare-and-set mechanism. Safe document
rejection now leaves cookie mutation to supported authentication operations;
rejection stays private and cannot authenticate an API. Explicit logout still
revokes its family and clears its page cookie.

### Credential-Issuing HTTP Outside The Shared Lock

A further actual two-tab Chromium/Guardian reproduction held an SDK logout
response while another tab invoked SDK login. Login HTTP reached Guardian and
installed its new page cookie before acquiring the shared lock at result
commit. The older logout response then removed that cookie; the existing family
fence correctly rejected the stale login result, leaving both sides anonymous.
Exact result fences cannot undo an already delivered `Set-Cookie` header.

The credential critical section therefore needs to cover request, response/body
consumption and credential publication, not just token storage. The correction
uses the existing browser coordinator with an explicit operation-owned
completion capability, avoiding nested non-reentrant lock acquisition. Queued
old-family intents remain stale: they retire before sending an HTTP request,
rather than replacing a newer account. A fresh anonymous retry is a new intent.
One-time action/continuation proofs are not automatically replayed to repair an
unknown network outcome.

Same-client anonymous authentication also has an operation-local intent fence:
an explicit new sign-in retires an older uncommitted exchange even before either
has a durable family ID. Passive continuation inspection does not start a new
sign-in intent. This preserves form supersession without allowing independent
tabs to bypass the shared cookie-writer section.

Admission and network/body work are bounded. Once a credential or restricted
continuation is actually committed, its existing local synchronization owner
takes over: an interrupted baseline preserves the committed-session error
contract, not a plain network timeout suggesting that one-time issue be replayed.

This contract concerns cooperating current Zero SDK clients on the same server
namespace. It cannot serialize a separate custom client which bypasses the SDK
or retroactively change code in an already open older-version tab.

### Bounded Access Rechecks And Completion Ownership

Automatic authorization reads and explicit access retry both bound headers and
body consumption through the existing session-request primitive. Timeout does
not revoke refresh proof; it makes a masked view actionable. A definitive
`401`/`403` is classified from headers without waiting for an optional error
body. Scope/client replacement cancels owned work, and synchronous retry-panel
unmount cannot undo a projection that was already accepted. Publication and
returned values remain fenced to the exact current request and authority.

## History And Root-Cause Precision

The rotating-child page binding and rejected-document deletion existed in
`2c5a4a46eee9ee17c9f3846a7b61e07cf76c4ced` (August 31). Hydration/recovery
guards were expanded later, including
`530c8672ba423808cba6b0ea4d998957a2c6b4f4` (September 29) and
`43b718a5fdf6fec4acf61524ba8d490da784e747` (October 6). The latter broadened
recovery admission and made automatic attempts visibly use the error panel.
This explains how newer UI behavior can expose both a new false-positive
guard and pre-existing credential races; it does not prove newly unstable
signing keys or cookie namespaces.

Persisted signing material and application-owned cookie names remained stable
across reconstructed Guardian runtimes in the focused baseline checks. Ordinary
rotation preserves the browser authorization family and parent session.
Routine profile/presence value revisions do not directly replace the route's
authorization revision. Genuine authority changes must still retire stale data.

## Security Guidance And Architectural Review

The approach was checked against primary guidance rather than justified only
by a passing UI test:

- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  supports strict server-issued session admission, server-side expiry and
  revocation, protected cookies and session replacement at security boundaries.
  This correction retains those boundaries; routine token rotation is not a
  new login or organization selection.
- [OAuth security BCP, RFC 9700 section 4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)
  describes rotating refresh credentials and replay detection. Zero retains
  one-use child rotation and family revocation rather than extending acceptance
  of consumed refresh credentials to hide a race.
- [HTTP cookie semantics, RFC 6265 section 4.1](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1)
  explicitly identifies races between concurrent `Set-Cookie` responses.
  Removing deletion from rejected read-only documents eliminates that writer;
  adding a UI retry cannot make cookie response ordering safe.

These references support the selected lifecycle design, not a claim of complete
OWASP certification or OAuth conformance for every Guardian/browser transport.
The existing bearer/refresh storage model is not being replaced with a new
cookie-authenticated API or backend-for-frontend architecture in this focused
fix. Page credentials still cannot authorize API writes.

## Qualification And Handoff

The runtime correction is committed as
`554caea1e5570ab4f52d3f4f82b2d75e004fbf7e`. The focused release retains the
framework's 2.6.0 source/local version; main/archive selection is verified by
the standard release hook and `zero-release --status`, not an npm tag.
A source correction or passing focused test does not prove a production
deployment. The normal consumer updater must install the saved committed main
archive; live rollout remains app-owned.

Final focused gates:

| Gate | Result |
| --- | --- |
| Combined core/session/transport/scope, 19 files | 241 passed, 1,254 assertions, zero failures; repeated against the clean committed runtime snapshot. |
| Server/page-proof/router/createApp, 7 files | 73 passed, 554 assertions, zero failures. |
| Independently reviewed changed transport/profile/controller, 3 files | 40 passed, 271 assertions, zero failures. |
| Public Guardian and frontend Markdown examples | 2 passed, 81 assertions; actual snippets compile through public source contracts. |
| Full TypeScript | Passed with incremental compilation disabled. |
| Actual Chromium restart/document/cross-tab writer regressions | 6 passed, 66 assertions; targeted evidence retained, not repeated for unrelated follow-ups. |
| Final acknowledged-cleanup/access-retry UI follow-up | 6 passed, 40 assertions, including bounded queued cleanup. |
| Documentation navigation/catalog | Zero problems; 997 catalog records map to 166 homes. |
| Diff hygiene | Passed. |

Receipts are under `/Volumes/code-bank/logs/zero-platform`:
`auth-refresh-clean-snapshot-core.log`,
`auth-refresh-clean-snapshot-typecheck.log`,
`auth-server-router-final-required-exp.log`,
`auth-independent-final-owned-exchanges.log`,
`auth-refresh-docs-examples-qualified.log`,
`auth-sdk-cookie-writer-and-restart-final.log`,
`auth-page-boundary-acknowledged-receipt-qualified.log`,
`auth-refresh-docs-navigation-final.log` and
`auth-refresh-docs-catalog-final.log`.

Verification is scoped to changed contracts. The targeted actual-browser
restart/document/cookie-writer regressions passed before final unrelated
transport adapter and malformed-proof checks. They are not repeatedly rerun for
changes which do not affect those browser paths; focused transport/server tests
and the compiler qualify those remaining changes.

The existing tenant select/create/switch/list transport already serializes its
operation but does not have a default operation deadline. This focused fix does
not claim a new deadline for every existing tenant-management endpoint, nor
qualify uncoordinated custom HTTP writers, external CDNs or mixed-version tabs.

Canonical behavior is documented in
[Guardian sessions](../../backend/guardian/sessions.md),
[AuthClient](../../frontend/guardian/auth-client.md),
[scope transitions](../../frontend/runtime/scope-transitions.md) and
[route authentication](../../frontend/router/authentication.md).
