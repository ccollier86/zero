---
id: zero.frontend.state.form-drafts
type: reference
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-form-drafts
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Preferences And Form Draft Helpers

[State index](./index.md) · [Documentation index](../../index.md)

usePreference and useFormDraft use durable server state, not unscoped localStorage.
They are public from @zero/framework/react/root or /react/hooks and require
authenticated State Sync. Organization/user ownership follows the server principal.

```tsx
import { usePreference, useFormDraft, useServerStateReady } from '@zero/framework/react';

const themeDensity = usePreference('density', 'comfortable');
const form = useFormDraft('tasks.new', { title: '', description: '' });
const ready = useServerStateReady();
```

This fragment belongs under the configured provider. usePreference(key,defaultValue)
returns value/setValue/reset. The key becomes preferences.<key>; reset writes the
default through the same state path.

useFormDraft(key,initialValue,{ namespace? }={}) requires an object of JSON values.
Default namespace is drafts, producing drafts.<key>. The result is draft/setDraft/
updateDraft/setField/resetDraft. updateDraft shallow-merges a partial;
setField writes one field using the current rendered draft; resetDraft writes
initialValue. Keys should be stable task/record identities, not random per render.

These helpers do not automatically subscribe to useForm, save every keystroke,
debounce writes, track accepted save receipts or merge collaborative edits.
They provide an explicit persistence path. App code chooses when to setDraft/
setField and whether to debounce, without resetting active editing on every
server echo. Read readiness before pushing fallback initial values.
A broader reusable autosave layer is future work, not a claim introduced by docs.

Use actual form include/validation/codec boundaries for final submission. A saved
draft is not a validated domain record. Avoid storing passwords/OTP/API keys;
setters are scope-bound, but JSON state is not a secret vault.

## Verification

Test navigation/restoration, snapshot readiness, deliberate reset, stable names,
same user in different organizations and retained callbacks. Optimistic setters
return void, not a durable acceptance receipt.

## Related Guides And Next Steps

- [Server state](./server-state.md) owns storage/readiness.
- [Forms](../forms/index.md) owns validated final submission.
- [Configuration](./configuration.md) owns prerequisites.
- [Roadmap](./roadmap.md) separates autosave expansion ideas.
