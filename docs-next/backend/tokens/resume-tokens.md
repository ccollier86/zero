---
id: zero.platform-tokens.resume
type: reference
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: reusable-resume-credentials
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

# Reusable Resume Tokens

[Platform tokens index](./index.md) · [Documentation index](../../index.md)

A resume token grants an application-defined continuation to one flow/resource,
until expiry/revocation/rotation. It is not a browser login session or automatic
authorization to all data belonging to a user.

## Creation And Verification

`createResumeToken(options)` requires nonblank flow and
resource `{ type, id }`. Optional subject, ttl, createdBy and metadata use
the shared creation contract. It returns `{ rawToken, record }`, with
record tokenId/flow/resource/subject/expiresAt/revokedAt/lastUsedAt/createdAt/
createdBy/rotatedFrom/metadata. Default TTL30d.

`verifyResumeToken(rawToken, { flow?, resource?, touch? })` checks exact
supplied bindings, expiry and revocation. It does not infer the current flow.
By default it updates lastUsedAt; touch:false is an inspection without that
write. Repeated valid verification is allowed and is not consume-once.

## Rotation And Revocation

`rotateResumeToken(rawToken, options?)` supports the lookup filters and
optional replacement ttl/metadata/createdBy. It preserves flow/resource/
subject, transactionally revokes the previous record and inserts the
replacement. The replacement has rotatedFrom and a newly returned raw secret.
Omitted metadata/createdBy retains the previous value; omitted ttl uses the
service's current configured default, not remaining prior lifetime.

`revokeResumeToken(rawToken)` and `revokeResumeTokenById(tokenId)`
return whether the live row was revoked. Storing the safe tokenId permits
revocation without incorrectly persisting the raw secret.
`cleanupExpiredResumeTokens()` deletes expired/revoked rows.

The development correction rejects at the exact expiry deadline and prevents
unsafe duration/expiry arithmetic. Rotation with invalid ttl rejects before
revoking the old token. The old secret must stop verifying after successful
rotation.

## Application Responsibility And Verification

The application owns which resource/fields/operations a verified token permits.
A token whose stored resource says draft does not enforce that resource's SQL
policy by itself. Verify exact binding and apply current domain rules before
using data services. Do not fabricate a Guardian session from the subject.

Test repeated verification, touch:false, wrong flow/resource, exact expiry,
rotation rollback and old-secret rejection. Treat returned secrets as bearer
credentials and store/display them only in the intended continuation channel.

- [Integration](./integration.md) owns authority and transaction domain.
- [Action tokens](./action-tokens.md) provides single-use claims.
- [Configuration](./configuration.md) owns duration parsing/defaults.
