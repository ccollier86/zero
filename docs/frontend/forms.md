# Form Library

Zero's form stack is currently strongest for schema-driven CRUD forms. It
already provides tokenized field primitives, generated forms, and a basic
animated wizard. The next step is to add an intake-grade composition layer
without making the simple CRUD path harder to use.

## Current Surface

| API | File | Current responsibility |
| --- | --- | --- |
| `useForm` | `src/hooks/use-form.ts` | Values, touched state, synchronous Valibot validation, optional `includeFields` projection, collection insert/update, reset, field registration. |
| `FieldRenderer` | `src/components/forms/field-renderer.tsx` | Converts schema field metadata into Zero input/select/date/tag/combobox controls. |
| `AutoForm` | `src/components/forms/auto-form.tsx` | Renders all schema fields—or an `includeFields` allow-list—into a create/edit form with optional card wrapper and submit/reset actions. |
| `Wizard` | `src/components/forms/wizard.tsx` | Renders manually declared steps with animated progress and per-step validation. |
| `useFormDraft` | `src/frontend/client/preference-hooks.ts` | Authenticated per-authorized-scope user draft state through State Sync. |
| `StorageDropzone` | `src/components/storage/storage-dropzone.tsx` | Ready upload surface backed by Zero storage hooks. |
| Platform tokens | `src/tokens` | Server-side action/resume tokens for email verification and continuation links. |

## What Works Well

- Field rendering is schema-driven and already uses Zero tokenized controls
  instead of raw browser controls.
- `AutoForm` is a good small-app and admin CRUD primitive.
- `Wizard` provides a useful foundation for staged forms and already has
  accessible progress feedback.
- `useForm` supports custom-submit forms without requiring `ClientProvider`,
  handles structural dirty checks for arrays/plain objects, and focuses the
  current first invalid field on submit.
- `AutoForm.collection` accepts either a collection object or a collection
  name, and boolean fields can opt into the animated switch renderer with
  `useSwitch`.
- Storage upload grants and resume tokens exist, which are the right backend
  primitives for public-but-private flows such as intake uploads.
- Field codecs are centralized, so array/json/date-range values do not require
  every component to reinvent persistence conversion.
- `includeFields` restricts rendering, validation, and submission together.
  `CrudPage.resourceFields` maps a shared `defineResourceFields()` contract to
  create/edit forms and readable table/export columns; the server resource
  boundary remains authoritative.

## Current Gaps

These are the main limits for complex forms and long public intake flows.

| Gap | Impact |
| --- | --- |
| CRUD-only metadata | `FieldMeta` describes inputs and table behavior, but not sections, field groups, conditional visibility, review labels, sensitivity, uploads, consents, or draft behavior. |
| Fixed renderer switch | `FieldRenderer` cannot register app-specific field widgets such as signature pads, address blocks, ID uploads, insurance-card uploads, or rich consent acknowledgements. |
| No draft adapter boundary | `useFormDraft()` is useful for signed-in user state, but the form library has no generic load/save/clear draft contract. |
| No public resume composition | Tokens and upload grants exist, but forms do not yet provide a simple `resumeToken` or `draftId` driven intake flow. |
| Static wizard path | `Wizard` supports fixed steps only. It does not support conditional steps, routeable steps, review pages, skipped-step tracking, or step-level autosave. |
| No attachment field | Storage is available, but there is no form field type that owns upload status, object metadata, accepted file policy, or required-document validation. |
| No consent/PDF hooks | Apps must manually connect form completion to consent PDF generation, workflow runs, storage writes, and database attachment records. |

## Design Direction

Keep the current APIs, but separate responsibilities more clearly:

- `AutoForm` stays the simple schema-to-form CRUD organism.
- `Wizard` stays a generic stepped form renderer.
- A new form blueprint layer describes rich form behavior without changing table
  schema definitions into a giant UI DSL.
- Draft persistence becomes adapter-driven so the same form engine can use
  memory, local storage, authenticated state sync, a resource row, or a public
  resume-token backed endpoint.
- Attachments, consents, signatures, and generated PDFs become field types or
  step plugins that compose Zero storage, tokens, workflows, and observability.

## Proposed Contracts

The rich layer should sit beside schema definitions:

```ts
import { defineForm, defineTable, field } from '@zero/framework/react';

export const intakeTable = defineTable('intake_drafts', {
  draft_id: field.id(),
  email: field.email({ required: true }),
  status: field.enum(['draft', 'verified', 'submitted']),
  payload: field.json(),
});

export const intakeForm = defineForm(intakeTable, {
  draftKey: 'draft_id',
  title: 'Clinic intake',
  progress: {
    variant: 'stepper',
    showStepNumbers: true,
  },
  sections: [
    {
      id: 'contact',
      title: 'Contact',
      fields: ['email', 'phone', 'preferred_contact'],
    },
    {
      id: 'insurance',
      title: 'Insurance',
      visibleWhen: ({ values }) => values.has_insurance === true,
      fields: ['insurance_provider', 'insurance_card_front', 'insurance_card_back'],
    },
    {
      id: 'assessments',
      title: 'Assessments',
      subsections: [
        {
          id: 'depression-screen',
          title: 'Depression screen',
          fields: ['phq_1', 'phq_2', 'phq_3'],
        },
        {
          id: 'substance-use',
          title: 'Substance use',
          visibleWhen: ({ values }) => values.reports_substance_use === true,
          fields: ['substance_type', 'substance_frequency'],
        },
      ],
    },
  ],
  steps: [
    { id: 'contact', title: 'Contact', sections: ['contact'] },
    { id: 'insurance', title: 'Insurance', sections: ['insurance'] },
    { id: 'assessments', title: 'Assessments', sections: ['assessments'] },
    { id: 'review', title: 'Review', type: 'review' },
  ],
});
```

Core blueprint types should stay small and composable:

```ts
export interface FormBlueprint {
  id?: string;
  title?: string;
  schema: SchemaDescriptor;
  draftKey?: string;
  sections?: FormSection[];
  steps?: FormStep[];
  progress?: FormProgressConfig;
  fields?: Record<string, FormFieldConfig>;
  autosave?: FormAutosaveConfig;
  continuation?: FormContinuationConfig;
  staffAssist?: FormStaffAssistConfig;
  review?: FormReviewConfig;
}

export interface FormSection {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  instructions?: string | FormInstruction[];
  fields?: string[];
  subsections?: FormSubsection[];
  columns?: number;
  visibleWhen?: FormVisibilityRule;
}

export interface FormSubsection {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  instructions?: string | FormInstruction[];
  fields: string[];
  columns?: number;
  visibleWhen?: FormVisibilityRule;
}

export interface FormStep {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  instructions?: string | FormInstruction[];
  type?: 'fields' | 'review' | 'submit';
  sections?: string[];
  visibleWhen?: FormVisibilityRule;
}

export interface FormProgressConfig {
  variant?: 'bar' | 'dots' | 'stepper';
  showStepNumbers?: boolean;
  showSkippedSteps?: boolean;
  compactBelow?: 'sm' | 'md' | 'lg';
}

export interface FormInstruction {
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  text: string;
}

export interface FormContinuationConfig {
  enabled: boolean;
  flow: string;
  resumeRoute: string;
  ttl?: string;
  rotateOnMilestones?: string[];
  sendLink?: {
    channel: 'email';
    subject?: string;
  };
}

export interface FormStaffAssistConfig {
  enabled: boolean;
  actorLabel?: string;
  requirePermission?: string;
  audit?: boolean;
}

export interface FormDraftAdapter<TValue = Record<string, unknown>> {
  load(): Promise<TValue | null>;
  save(value: TValue, event: FormDraftEvent): Promise<void>;
  clear(): Promise<void>;
}
```

Visibility rules should be data-first and testable:

```ts
visibleWhen: ({ values, user }) =>
  values.has_insurance === true && user?.role !== 'guest'
```

The rule receives only the values and safe context it needs. Security-sensitive
decisions still belong on the server. Frontend visibility is convenience, not
authorization.

## Steps, Sections, And Subsections

The blueprint should separate content from navigation:

| Concept | Responsibility |
| --- | --- |
| `sections` | Named content groups such as contact, insurance, assessments, consents, and uploads. |
| `subsections` | Smaller groups inside a section, such as one subsection per assessment inside an assessment phase. |
| `steps` | Navigation/progress units that decide which sections appear together. |
| `progress` | Stepper/progress presentation: dots, numbered steps, progress bar, compact mobile mode, and completed/skipped state. |

This gives complex forms a clean model. A medical intake can have an
`assessments` step, and that step can contain subsections for each assessment.
Each subsection can appear only when previous answers make it relevant.

Sections and subsections can carry presentation copy without forcing custom
wrappers:

```ts
{
  id: 'consents',
  title: 'Consents',
  subtitle: 'Review and sign before submitting',
  description: 'These documents explain treatment, privacy, and payment terms.',
  instructions: [
    { tone: 'info', text: 'Read each consent before signing.' },
    { tone: 'warning', text: 'A parent or guardian must sign for minors.' },
  ],
  fields: ['telehealth_consent', 'privacy_notice', 'financial_policy'],
}
```

The renderer should use consistent Zero typography, alerts/callouts, spacing,
and tokens for this copy. The copy is app content; the layout and visual
treatment remain platform-owned.

Conditions should be available at multiple levels:

```ts
fields: {
  guardian_name: {
    visibleWhen: ({ values }) => Number(values.age ?? 0) < 18,
  },
},
sections: [
  {
    id: 'insurance',
    title: 'Insurance',
    visibleWhen: ({ values }) => values.has_insurance === true,
    fields: ['insurance_provider'],
  },
],
steps: [
  {
    id: 'behavioral-health',
    title: 'Behavioral health',
    sections: ['behavioral-health'],
    visibleWhen: ({ values }) => values.requests_behavioral_health === true,
  },
]
```

The renderer should recompute the active step, section, subsection, and field
tree whenever dependent values change. Skipped steps should stay visible in
progress history only when the caller asks for that behavior; the default
should be a clean active-step list that only includes currently relevant work.
Final submit still has to validate server-side. Hidden fields and skipped
sections are presentation decisions; app-owned backend routes decide which
values are accepted, cleared, retained, audited, or rejected.

## Draft And Resume Architecture

Complex intake needs three draft modes:

| Mode | Use case | Adapter |
| --- | --- | --- |
| Local draft | Unsaved UI work, demos, or forms that do not need cross-device resume. | `createLocalFormDraftAdapter()` |
| Authenticated draft | Signed-in user preferences or account-owned drafts. | `createStateSyncFormDraftAdapter()` over `useFormDraft()` |
| Public resume draft | Anonymous intake, applications, quotes, and consent packets. | `createResumeTokenFormDraftAdapter()` calling app-owned backend endpoints that verify `zero.tokens`. |

For public intake:

1. The app creates a draft row and sends an email action token.
2. The user verifies email by consuming the action token.
3. The app creates or rotates a resume token scoped to the draft.
4. The browser autosaves through an app endpoint that verifies the resume token.
5. Upload fields request scoped storage upload grants from the backend.
6. Final submit verifies the resume token, validates the full payload
   server-side, generates PDFs or workflow jobs, revokes the resume token, and
   marks the draft submitted.

This keeps public flows convenient without making private drives or draft rows
publicly writable.

The platform-provided autosave table should track safe token identifiers, not
raw tokens. A default row shape should look like this:

```ts
interface StoredFormDraft {
  draft_id: string;
  form_id: string;
  form_version?: string;
  flow?: string;
  status: 'draft' | 'verified' | 'submitted' | 'abandoned' | 'expired';
  active_resume_token_id?: string;
  resume_expires_at?: number;
  current_step_id?: string;
  current_section_id?: string;
  values_json: Record<string, unknown>;
  meta_json?: Record<string, unknown>;
  revision: number;
  created_at: number;
  updated_at: number;
  expires_at?: number;
  submitted_at?: number;
}

interface StoredFormDraftRevision {
  revision_id: string;
  draft_id: string;
  revision: number;
  actor_type: 'resume-token' | 'user' | 'staff' | 'system';
  actor_id?: string;
  actor_token_id?: string;
  step_id?: string;
  values_json: Record<string, unknown>;
  created_at: number;
}
```

`active_resume_token_id` is the safe `record.tokenId` returned by
`zero.tokens.createResumeToken()` or `zero.tokens.rotateResumeToken()`. It gives
the draft/autosave layer a stable pointer for admin UI, resend/rotate/revoke
workflows, and continuation status. The token service remains the authority for
validation because `_zero_resume_tokens` stores the hash, expiration,
revocation state, flow, resource, subject, `lastUsedAt`, and `rotatedFrom`.
Autosave revisions can also record `actor_token_id` from
`zero.tokens.verifyResumeToken(token).tokenId` so audit trails can say which
verified resume-token session saved a change without storing the raw token.

Do not create a separate form-specific token table. Form drafts should point to
the framework token service by token id. Planned form-draft API shape:

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

await zero.forms.drafts.markResumeToken({
  draftId,
  activeResumeTokenId: resume.record.tokenId,
  resumeExpiresAt: resume.record.expiresAt,
});

// Later, on autosave:
const verified = zero.tokens.verifyResumeToken(rawToken, {
  flow: 'clinic-intake',
  resource: { type: 'form-draft', id: draftId },
});

await zero.forms.drafts.saveRevision({
  draftId,
  values,
  actorType: 'resume-token',
  actorTokenId: verified.tokenId,
  stepId,
});
```

## Continuation And Staff Assist

Long public forms should make the "continue later" process easy to bake into
the app. The main user should not need an account, but they should need a valid
resume token to reopen the draft. Staff should be able to help through their
own authenticated staff route without borrowing or exposing the user's public
token.

The blueprint should declare the continuation policy:

```ts
export const intakeForm = defineForm(intakeTable, {
  title: 'Clinic intake',
  draftKey: 'draft_id',
  continuation: {
    enabled: true,
    flow: 'clinic-intake',
    resumeRoute: '/intake/resume',
    ttl: '14d',
    rotateOnMilestones: ['email-verified', 'submitted'],
    sendLink: {
      channel: 'email',
      subject: 'Continue your clinic intake',
    },
  },
  staffAssist: {
    enabled: true,
    actorLabel: 'staff',
    requirePermission: 'intake.assist',
    audit: true,
  },
});
```

The frontend should then get small adapters instead of hand-written token
plumbing:

```tsx
const draft = createResumeTokenFormDraftAdapter({
  token,
  flow: 'clinic-intake',
});

<IntakeForm blueprint={intakeForm} draft={draft} />
```

For staff:

```tsx
const draft = createStaffAssistFormDraftAdapter({
  draftId,
  flow: 'clinic-intake',
});

<IntakeForm blueprint={intakeForm} draft={draft} mode="staff-assist" />
```

The server helper should own the repeatable backend workflow:

```ts
const intakeContinuation = createFormContinuationService({
  flow: 'clinic-intake',
  table: 'intake_drafts',
  primaryKey: 'draft_id',
  emailField: 'email',
  tokenTTL: '14d',
});

await intakeContinuation.start({ email });
await intakeContinuation.verifyEmail({ actionToken });
await intakeContinuation.sendResumeLink({ draftId });
await intakeContinuation.loadByResumeToken({ token });
await intakeContinuation.saveByResumeToken({ token, values, stepId });
await intakeContinuation.loadForStaff({ draftId, actor });
await intakeContinuation.saveForStaff({ draftId, actor, values, stepId });
await intakeContinuation.submit({ token, values });
```

The helper should compose existing Zero services:

| Need | Zero primitive |
| --- | --- |
| Email verification | `zero.tokens.createActionToken()` and `consumeActionToken()` |
| Continue-later link | `zero.tokens.createResumeToken()`, `verifyResumeToken()`, `rotateResumeToken()`, and `revokeResumeToken()` |
| Email delivery | `zero.email` |
| Draft storage | App table through ReactiveDB/resource routes |
| Public uploads | `zero.storage.uploads.create()` after resume-token verification |
| Staff assist | Authenticated staff policy plus audit actor metadata |
| Audit trail | Observability/audit events for start, verify, link sent, resume, save, staff assist, upload, and submit |

Recommended behavior:

1. Create the draft row before sending the first verification link.
2. Let the token service store token hashes. Form drafts may store safe token
   IDs, but never raw resume tokens in draft rows, metadata, logs, or
   observability payloads.
3. Keep one active public resume token per draft unless the app explicitly
   allows multiple devices.
4. Let staff resend or rotate a resume link. When rotating, update
   `active_resume_token_id` to the replacement `record.tokenId`, but do not
   show the raw current token after creation.
5. Record the actor on every save: public resume token, authenticated user, or
   staff assist.
6. Allow partial invalid draft saves, but run full server validation on final
   submit.
7. Revoke public resume tokens after final submit or abandonment.

## Autosave Behavior

The form engine should support these policies:

| Policy | Meaning |
| --- | --- |
| `onBlur` | Save after a field loses focus if the form changed. Good for long forms. |
| `debouncedChange` | Save while typing after a delay. Good for notes and rich text. |
| `manual` | Caller decides when to save. Good for short forms. |
| `stepChange` | Save when moving between wizard steps. Good for staged intake. |

The default intake policy should be `onBlur` plus a throttle, for example:

```ts
autosave: {
  mode: 'onBlur',
  minIntervalMs: 5000,
  saveInvalid: true,
}
```

Saving invalid partial data is important for intake. Validation should block
final submission, not draft recovery.

## Attachment Fields

The form layer should expose a first-class attachment field that wraps
`StorageDropzone` and stores normalized object metadata in the form value.

```ts
fields: {
  insurance_card_front: {
    type: 'attachment',
    label: 'Insurance card front',
    required: true,
    accept: ['image/png', 'image/jpeg', 'application/pdf'],
    maxSize: '10MB',
    storage: {
      drive: 'private-intake',
      path: ({ draftId }) => `/intakes/${draftId}/insurance/front`,
      grant: 'resume-token',
    },
  },
}
```

The field should not bypass backend policy. It should request an upload grant,
show upload progress, persist returned object metadata, and let the final
submit endpoint verify required attachments.

## Consent, Signature, And PDF Flow

Consent-heavy apps should not have to build the same orchestration each time.
Zero should eventually provide:

- `ConsentField` for required acknowledgements with versioned consent text.
- `SignatureField` for typed or drawn signatures.
- `ReviewStep` for grouped read-only review before submit.
- `onComplete` workflow helpers that can generate PDFs, store them in a bucket,
  and attach object IDs to the submitted row.
- Audit events for viewed consent, signed consent, uploaded document, resumed
  draft, staff-assisted edit, and final submission.

This can build on existing workflows, storage, observability, and token
services instead of adding a separate intake subsystem.

## Implementation Phases

1. **Form fundamentals** - complete
   - First-error focus now uses the current validation result in `useForm`.
   - Dirty checks now compare arrays, dates, and plain objects structurally.
   - `useForm` can operate without `ClientProvider` when no collection name is
     provided.
   - `AutoForm.collection` now matches `useForm` and accepts a collection
     object or collection name.
   - Boolean field overrides now honor `useSwitch` through Zero's animated
     switch primitive.

2. **Renderer extension**
   - Add a field renderer registry so platform and app fields can be registered
     without editing one giant switch.
   - Add standard app-ready renderers for attachment, radio, switch, segmented
     choice, address block, phone, masked input, and signature.
   - Keep every renderer on Zero components and design tokens.

3. **Blueprint layout**
   - Add `defineForm()` and `FormBlueprint`.
   - Support sections, subsections, field groups, columns, spans,
     descriptions, helper content, conditional visibility, dependency
     tracking, and review labels.
   - Add `steps` and `progress` metadata to the blueprint, but keep rendering
     concerns in the form/wizard organisms.
   - Keep table schema focused on data. Use blueprint metadata for rich UI.

4. **Draft adapters**
   - Add a draft adapter interface and status model: idle, loading, saving,
     saved, error, offline.
   - Ship local, authenticated state-sync, and resource-row adapters.
   - Add public resume-token examples and helpers, but keep endpoints app-owned
     because each app controls its public flow policy.

5. **Intake wizard**
   - Build an `IntakeForm` or `SmartWizard` organism on top of `FormBlueprint`.
   - Support conditional steps, subsection rendering, skipped steps, step
     validation, review, autosave, routeable step IDs, progress recovery, and
     resume state.
   - Provide a tokenized stepper/progress component that can render numbered
     steps, progress bars, completed/skipped state, and compact mobile state.

6. **Storage and PDF composition**
   - Add attachment fields backed by storage upload grants.
   - Add completion hooks for workflow starts, PDF generation, and attachment
     linking.
   - Document the full intake architecture with tokens, uploads, PDFs, and
     staff assist.

7. **Audit and staff assist**
   - Emit structured observability/audit events from draft load/save, token
     resume, upload, consent, signature, staff-assisted edit, and submit.
   - Add optional staff takeover context so audit records can distinguish
     patient-entered fields from staff-entered fields.

## Guidance For Agents

When building a form in a Zero app:

1. Use `AutoForm` for normal CRUD.
2. Use `Wizard` for simple fixed multi-step forms.
3. Use Zero input/select/date/tag/combobox/dropzone components instead of raw
   HTML controls.
4. For public continuation flows, use backend-verified resume tokens and
   storage upload grants. Do not make private storage public.
5. For complex intake, prefer a form blueprint and draft adapter once those APIs
   exist. Until then, keep app-specific orchestration in app code and do not
   hard-code one clinic or one domain into shared platform components.
