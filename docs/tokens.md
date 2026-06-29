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

## Storage

The service owns these framework tables:

| Table | Purpose |
| --- | --- |
| `_zero_action_tokens` | Generic consume-once action tokens. |
| `_zero_resume_tokens` | Long-lived resume/continuation tokens. |

Raw tokens are never stored. Do not put raw tokens, passwords, or provider
secrets in token metadata.

## Auth Compatibility

Auth password setup/reset still uses `/auth/action-token/:token`,
`/auth/reset-password`, and `/auth/setup-password`. Internally those flows now
delegate to the generic action-token service while preserving the existing auth
API and frontend components.
