# Platform Tokens

Zero includes a generic server-side token service for secure links and public
continuation flows. It is mounted by `createApp()` and exposed to app-owned
backend code as `zero.tokens`.

Use this service instead of building one-off token tables. It stores only
SHA-256 token hashes, emits observability events, and keeps the raw token
available only at creation time.

## Action Tokens

Action tokens are short-lived and consume-once. Use them for any one-time
verification or guarded action:

- email verification
- invite acceptance
- password setup or reset
- confirming a destructive action
- verifying public form ownership before final submit

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/intake/start',
  async handler({ body, zero }) {
    if (!zero.tokens) throw new Error('Platform tokens are not ready.');

    const draftId = crypto.randomUUID();

    const verification = zero.tokens.createActionToken({
      purpose: 'intake.email.verify',
      subject: { type: 'intake-draft', id: draftId },
      scope: 'clinic-intake',
      ttl: '30m',
      cooldown: '5m',
      metadata: {
        email: body.email,
      },
    });

    await zero.email.send({
      to: body.email,
      subject: 'Continue your intake',
      text: `Open this link: ${verification.rawToken}`,
    });

    return { draftId };
  },
});
```

Consume an action token at the state-changing step:

```ts
const verified = zero.tokens.consumeActionToken(token, {
  purposes: ['intake.email.verify'],
  scope: 'clinic-intake',
});

// verified.subject identifies the draft or user the token belongs to.
```

Inspection is available for rendering a screen before final submit:

```ts
const action = zero.tokens.inspectActionToken(token, {
  purposes: ['invite.accept'],
});
```

Inspection does not consume the token; `consumeActionToken()` is still required
for the final action.

## Resume Tokens

Resume tokens are long-lived, reusable continuation tokens. Use them when a
public user may leave a multi-step flow and come back later:

- appointment intake drafts
- consent packets
- quote/application forms
- onboarding flows before account creation

```ts
const resume = zero.tokens.createResumeToken({
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
  subject: { type: 'email', id: email },
  ttl: '14d',
  metadata: {
    step: 'medical-history',
  },
});
```

Verify a resume token whenever the user returns:

```ts
const resume = zero.tokens.verifyResumeToken(token, {
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
});
```

Verification does not consume the token. By default it updates `lastUsedAt` so
apps can audit continuation activity. Pass `touch: false` to inspect without
updating activity.

Rotate after sensitive milestones:

```ts
const next = zero.tokens.rotateResumeToken(token, {
  flow: 'clinic-intake',
  ttl: '14d',
  metadata: { step: 'consents' },
});
```

Revoke when the flow is completed or abandoned:

```ts
zero.tokens.revokeResumeToken(token);
```

When an app correctly stores only the safe `record.tokenId`, it may revoke the
previous active continuation credential without retaining its raw value:

```ts
zero.tokens.revokeResumeTokenById(activeResumeTokenId);
```

## Storage

The service owns these framework tables:

| Table | Purpose |
| --- | --- |
| `_zero_action_tokens` | Generic consume-once action tokens. |
| `_zero_resume_tokens` | Long-lived resume/continuation tokens. |

Raw tokens are never stored. Do not put raw tokens, passwords, or provider
secrets in token metadata.

## Pairing With Storage Upload Grants

Resume tokens are a good fit for long public flows such as intake forms. When a
public user needs to upload private documents during that flow, do not make the
drive public. Verify the resume token in app backend code, then create a scoped
storage upload grant with `zero.storage.uploads.create()`. Return that grant to
the browser and upload with `PUT /storage/upload-grants/:token`.

The resume token controls whether the user may continue the flow. The upload
grant controls one exact file write. Reads remain governed by normal storage
permissions.

## Pairing With Autosaved Forms

Autosaved form drafts should use this token service directly. Do not build a
form-specific token table. Store the safe `record.tokenId` on the draft row and
on revision/audit rows, but never store the raw token.

```ts
const resume = zero.tokens.createResumeToken({
  flow: 'clinic-intake',
  resource: { type: 'form-draft', id: draftId },
  subject: { type: 'email', id: email },
  ttl: '14d',
  metadata: {
    formId: 'clinic-intake',
    formVersion: '1.0.0',
  },
});

await formDrafts.markResumeToken({
  draftId,
  activeResumeTokenId: resume.record.tokenId,
  resumeExpiresAt: resume.record.expiresAt,
});
```

When a browser autosaves, verify the raw token first and stamp the draft
revision with the returned token id:

```ts
const verified = zero.tokens.verifyResumeToken(rawToken, {
  flow: 'clinic-intake',
  resource: { type: 'form-draft', id: draftId },
});

await formDrafts.saveRevision({
  draftId,
  values,
  actorType: 'resume-token',
  actorTokenId: verified.tokenId,
});
```

The token record remains the source of truth for hash validation, expiration,
revocation, rotation, `lastUsedAt`, flow, resource, and subject. The form draft
row only keeps safe pointers and form state.

## Auth Compatibility

Auth password setup/reset still uses `/auth/action-token/:token`,
`/auth/reset-password`, and `/auth/setup-password`. Internally those flows now
delegate to the generic action-token service while preserving the existing auth
API and frontend components.
