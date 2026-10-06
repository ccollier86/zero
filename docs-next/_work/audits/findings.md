---
id: zero.documentation-audit-findings
type: operations
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Findings And Correction Ledger

[Audit index](./index.md) · [Documentation index](../../index.md)

The user authorized correction of all confirmed defects found during this
source-backed rebuild. Missing roadmap features are not automatically defects;
applications, live data and deployments remain out of scope. Original main
baseline: `a3a5f726768dac890f241a3899c0a1acb66265d9`, 2.1.1. Targeted
working fixes below are not released-artifact claims. Their review-state wording
records the original audit checkpoint, not a claim that those tasks are still
running on the current branch. Later authorized releases and qualification have
separate records in the [execution ledger](./execution.md) and
[2.5.0 reader qualification](./docs-plugin-qualification.md).

## Confirmed Corrections

| Finding | Evidence and correction | Verification / state |
| --- | --- | --- |
| Scheduler ignores catchErrors=false | Unconditional catch swallowed errors; Croner now handles default true policy, while false emits unhandled failure and rethrows original error. | Service/plugin checks now 7/7 pass; independent source review complete, artifact pending. |
| Form success precedes write confirmation and duplicate/stale submits | Built-in submit used optimistic void insert/update; now awaits insertAsync/updateAsync with synchronous duplicate guard and scope-safe finalization. | Four form receipt/race regressions pass; collection checks also previously passed; independent diff review underway. |
| Wizard invalid/dynamic steps | Empty steps crashed, unknown fields skipped; validates steps and reconciles changed layouts before using stale indices, retaining equivalent arrays and form values. | Initial SSR2pass/3fail then5pass; dynamic browser regression also passes in the UI closeout set. |
| UI wildcard exposes tests | Wildcard included three tests; explicit null exclusions for *.test/*.spec preserve intended components. | Public resolution checks 2/2 pass; archive qualification pending. |
| Vector invalid enums silently change index intent | Invalid metric/indexType admitted then fallback selected cosine/HNSW; resolver now rejects with VECTOR_CONFIG_INVALID. | Before fix 6 pass/2 fail; config/filter checks now 15/15 pass; all valid enum combinations preserved. |
| Stale source comments | KV/persistence barrels described implemented integration as future slices. | Comments corrected; no new capability inferred. |
| Email readiness differs from captured credentials | Empty configured key was incorrectly replaced only in readiness by ambient env; later env changes also drifted from the adapter snapshot. | Readiness now asks captured Resend configuration; whitespace rejection matches it. Email16 + ingest13 synthetic tests pass together, no provider calls. |
| Frontend log ingest limit/parse behavior | Headerless/underreported bodies bypassed Content-Length check; dynamic malformed JSON produced500. | Bounded stream inspection plus route-known JSON ParseError classification; focused13pass, independent review complete. |
| Scheduler partial composition and setup errors | Failed publication could retain jobs/binding; setup failures had no stable code. | Failed callback now cleans up; additive setup errors, NOT_FOUND HTTP retained. Before follow-up 4 pass/3 fail, after 7/7 pass. |
| Torrent memory delete result | Newly staged key was removed but delete incorrectly returned false. | Return reflects attempt-visible existence; failing reproduction then three focused in-memory checks pass. |
| Schema text default quoting | Apostrophes in text defaults produced invalid SQLite declaration syntax. | Reproduced using a disposable in-memory SQLite table; defaults now escape SQL literal quotes, no app database opened. |
| Hold confirmation lifecycle | Keyboard was unavailable; cancelled/unmounted/replaced holds could complete, wall-clock jumps shortened duration, invalid duration had no admission. | Keyboard/pointer/focus/visibility/action cancellation, monotonic timing and finite positive duration checks. Combined UI scope33pass; independent diff review in progress. |
| Generic confirmation lifecycle/rendering | Superseding/unmount left promises pending; default AlertDialog could fail opening or remain active after close; custom hold label ignored. | Deterministic false cancellation, exact promise settlement and explicit animation/focus cleanup;10focused checks pass, no real deletion. |
| Link native/render-prefetch contract | Render prefetch unimplemented; download/protocol-relative external links intercepted incorrectly. | Normal anchor admission and render/intent prefetch corrected; original4/6fail then6pass/27assertions. |
| CRUD success before acceptance | Custom callbacks bypassed useForm receipt fix, closed wrong modal and lacked duplicate/stale operation fencing. | Shared acknowledged source/mutation lifecycle;17browser checks/77assertions pass, accepted callback failure remains distinct from failed write. |
| Master-detail server query/update integration | Source controls did not drive server queries; update promise discarded; numeric IDs, readonly writes and stale callbacks failed. | Shared internal DataTable controller and accepted-result selection/write fencing;25focused table/master checks pass, APIs unchanged. |
| Guardian configuration truthfulness | Reserved MFA flags projected enabled without implementation; API-key scope-role allowlist wrongly rejected administration-only declared roles. | Reserved true flags reject with AUTH_CONFIG_UNSUPPORTED_FEATURE; false/default remain. Administration membership eligibility allowed without customer platform roles.38focused checks/307assertions pass. |
| AI session state races/admission | Invalid history limits accepted; sends mixed mutable history; clear/append and exported/seed aliases could retain stale replies. | Per-session FIFO, snapshots and history revision fences; original3pass/9fail then23focused checks/63assertions pass. Approximate retention policy preserved. |
| Schema inference/default/nullable wire contracts | Validator type erasure and invalid neutral defaults broke logical inference and optional fields; undefined numeric clears vanished in JSON updates. | Exact field/descriptor inference, deliberate absence/default validation and explicit numeric null; current eight-file run81pass/382assertions, independent four-file run45pass/205assertions. |
| Declared table loading intent lost | Raw schema().serverTables discarded explicit full/lazy/auto during app resolution. | Private symbol preserves declaration intent; explicit per-table config still wins; mode/resolver39pass/178assertions. |
| Explicit zero text bounds ignored | maxLength:0 was ignored by truthiness checks for text/textarea/password. | !=null checks preserve required/nonblank constraints and default admission; final default+inline24pass/118assertions, independent configuration22pass/105assertions. |
| AI video result integrity | Generated files could exceed requested count or contain empty media; completed binary/base64 could be empty. | Requested count and non-empty payload admission; original7pass/4fail then11pass/39assertions using synthetic providers. |
| AI workflow controls silently omitted | Declared maxRetries/timeout/headers/reasoning and other request controls never reached conversation service. | Shared bounded request-control projection, handler-only fields excluded; original5pass/2fail then12focusedpass/46assertions. |
| Doctor suppresses auth path warnings with managed TTLs | accessTokenTTL/refreshTokenTTL were passed into strict behavior resolution, causing unrelated path checks to return empty. | Strip managed token fields before behavior resolution; original2pass/3fail then5pass/16assertions with synthetic config only. |
| Frontend navigation/hydration races | Delayed old route loads overwrote page/params/auth or redirected after unmount; server fallback lost query/hash. | Navigation generation/active/current-path fences and full committed URL; original0pass/4fail then runtime+Link10pass/36assertions. |
| AI agent context inference | A no-context facade inferred an unsatisfiable execution context; declared non-undefined contexts still need to be supplied. | Default context is undefined with typed explicit contexts preserved; source snippets compile and independent review is complete. |
| Form accepted-success notification | Throwing/rejected onSuccess was classified as failed persistence and could present a duplicate retry. | Accepted write outcome stays accepted; safe separate notification reporting, legacy write handlers preserved. Hook6pass/37assertions; hook+AutoForm12pass/49assertions and independent hook review. |
| Table accepted-edit notification | onCellEdit rejection after source acceptance offered a write Retry. | Authoritative legacy handlers remain authoritative; post-acceptance callbacks report separately and stale settlement is suppressed. Real isolated table3pass/15assertions independently rerun. |
| Generic SQL transaction boundary | Failed BEGIN leaked depth, thenable callbacks could commit before settling, rollback failure hid its original error. | Synchronous admission/inference, depth-finally, opened-boundary rollback, AggregateError preservation and safe standard rollback-failure observation. Pool+transaction11pass/49assertions independently reviewed/rerun. |
| Buffer pool bounds/release | Warmup exceeded small/zero retention limits; discarded known buffers weren't zeroed; invalid bounds were admitted. | Bounded warmup, safe integer admission before opening SQL and zero every known release, including discarded buffers. Pool+transaction11pass/49assertions independently reviewed/rerun. |
| Fabric implicit dotenv inheritance | Bun auto-loaded cwd dotenv even with explicit empty spawn env; compiled Bun ignored runtime --no-env-file. | Source argv disables env-file autoload; default bundle factory uses owned empty cwd and settlement-only safe cleanup. Actual compiled Bun/IPC synthetic environment test passes. Four-file actor suite45pass/174assertions; independent focused4pass/14assertions. |
| Password visibility keyboard exclusion | Explicit tabIndex=-1 prevented keyboard access to the show/hide control. | Removed exclusion with no layout/prop change; actual isolated component1pass/5assertions. |
| OTP duplicate verification/resend | Same-tick repeated resend and edits during pending verification admitted concurrent callbacks. | Synchronous admission fence, disabled pending controls and unmount-safe completion; baseline1pass/2fail then3pass/11assertions, independently rerun. |
| CSV header/CR and spreadsheet formula output | Headers weren't escaped and CR/formula-like string cells were exported unsafely. | Shared CSV escaping and spreadsheet-safe string representation preserve numeric values. Synthetic real-table download capture16pass/16assertions independently rerun; not Office execution certification. |
| Notification HTTP JSON/enum admission | Malformed metadata caused500; wrong JSON audience/metadata shapes and unknown target/display enums bypassed valid-domain input checks. | Safe JSON-object/nonempty-ID-array parser plus Elysia enums reject before writes; valid JSON-string wire input retained. Baseline0pass1fail; notification routes+advanced RBAC12pass69assertions, independently reviewed/rerun. |
| Room HTTP metadata/capacity admission | Malformed metadata caused500/wrong shapes were stored; zero/negative/fractional/unsafe capacity could not consistently include the required owner. | Safe metadata parser, positive-safe-integer route DTO and domain RoomInputError before persistence. Baseline metadata0pass1fail and capacity0pass1fail; final room11pass81assertions, independently reviewed/rerun. |
| Platform token deadline and lifetime arithmetic | Action/resume tokens accepted exactly at expiry; malformed/unsafe duration or expiry arithmetic lacked structured admission, including direct Guardian action path. | Deadline rejection/cleanup parity, checked duration+expiry, runtime type admission and PlatformTokenError TOKEN_INPUT_INVALID. Baseline generic0pass2fail/directAuth0pass1fail; final generic/runtime/Guardian26pass115assertions, independently reviewed/rerun. |
| Observability retention admission | NaN/Infinity could turn bounded recent-memory retention into unbounded state; fractional/nonpositive/unsafe values lacked deliberate admission. | Positive safe integer retention before state, shared ObservabilityConfigurationError/OBSERVABILITY_CONFIG_INVALID; baseline0pass1fail then store/plugin/ingest24pass69assertions, independently reviewed/rerun. |
| PDF app ownership and failed publication | Managed events followed ambient runtime; default writer used ambient Storage; throwing publication callback abandoned renderer cleanup. | Captured app emitter/lazy owned writer and shared cleanup registered before publication, stable composition error. New synthetic reproductions failed before corrections; final six-file PDF 22 tests / 63 assertions, independently reviewed and rerun. |
| PDF private IPv6 literal classification | Unspecified/mapped-private/full-link-local literals escaped host blocking and similarly named DNS hosts were falsely treated as IPv6. | Normalized literal ranges/mapped IPv4 checks; original0pass1fail, six-file synthetic PDF22pass63assertions. Initial independent review clean; this is URL policy, not DNS/network/browser certification. |
| Page-scoped table selection | Controlled local pagination retained previous-page selection in bulk/toolbar/footer projections. | One current-row-model projection covers page targets consistently; baseline failed then13pass/74assertions; independent review complete. |
| Migration premature completion and generated rollback | Promise-returning up/down committed success early; native async/generator handlers admitted; generated no-op down reported an inverse that did nothing. | Synchronous admission/execution guard, rollback before ledger success and safe public MIGRATION_HANDLER_INVALID. Independent original35pass/149assertions; final extra async-down/rejecting-thenable/checksum coverage38pass/158assertions across four files. |
| useMutation accepted notification and lifetime | A failing success notification rejected an accepted write; reset/unmount/scope races could expose stale presentation. | Accepted results remain accepted, notification failures separately observed, concurrent pending groups and scope/lifetime fenced; root9pass/44assertions independently reviewed, with forms15pass/81assertions. |
| useDataPage result membership and manual lifetime | Shared collection contents replaced query order/membership; manual refresh was suppressed, and autoLoad:false manual requests lacked unmount cleanup. | Page-owned ordered declared-key IDs and retained records, table-local authoritative reconciliation, supersession/scope fences and independent mounted cleanup. Final hook13 plus collection10 independently reviewed/rerun; combined with Doctor33pass/77assertions. |
| Vector scope integrity and unbounded admission | Scoped replacement could seize another scope's guessed ID and new queued ordering needed a finite bound. | Candidate/existing-ID checks share ordinary per-index writes; detached inputs, independent indexes, fixed128/index and1024/service capacity, failure release and awaited disposal. Synthetic39pass/142assertions independently reviewed/rerun; not distributed/native batch atomicity. |
| Doctor recursive source paths | Generated glob regex rewrote its own wildcard and failed nested exclusions/allow paths. | Single-pass caller-wildcard replacement, globstar zero/deep paths and segment-local stars preserved. Baseline0pass/2fail, final10pass/32assertions independently reviewed/rerun using owned temporary source only. |
| Data Studio impossible datetime normalization | Date.parse accepted invalid calendar dates by shifting them to the next month. | Calendar validity checked before datetime normalization; invalid dates reject while leap-day/offset results remain valid. New+existing codec13pass/60assertions independently reviewed/rerun; no database. |
| Modal close callback reentrancy/failure | Recursive/throwing close callbacks blocked dismissal or closeAll confirmation cleanup. | Commit dismissal/clear before notifications, fence repeated close, retain callback-created content and safely observe sync/async notification failures. Baseline0pass/5fail; events/store/confirm11pass/30assertions independently reviewed/rerun. |
| Generic async/state hook contracts | Accepted callback failure rejected an accepted action; reset/concurrent/unmount lacked lifecycle; controlled local state overrode parent and DOM state lacked SSR snapshot. | Separate awaited notifications, original action error retained, pending/generation/mounted fences; parent-authoritative value and stable null SSR. Final async7/state3 independently reviewed/rerun; with paged hook23pass/58assertions. |
| Storage drop-event rejection | Automatic drag/drop discarded the Promise while uploadFiles reports and rethrows failure. | Focused event admission observes the reported rejection without changing imperative rejection or scope checks. Admission + existing queue/authenticated XHR 10 tests / 29 assertions, independently reviewed/rerun; no app or file storage. |
| Storage same-scope target and component lifetime | New path could render old metadata, retained actions could target the old object, and drive replacement retained old path/selection. Retained handlers also remained admissible after unmount. | Target-specific request/result/callback identities plus independent mounted/aborted-result fences. Original actual synthetic hook reproduction 0 passed / 3 failed; final selection/admission/queue/XHR 15 tests / 40 assertions, independently reviewed/rerun. Wrong-target UI behavior, not evidence of backend permission bypass. |
| Storage limit validation and form-event failure | Invalid/negative/fractional/unsafe byte drafts could become unlimited; parent-reported rejected onSave escaped the form event. | Validate whole safe byte counts before callback; explicit blank/0 remains supported; observe rejected form callback without fictional success. Initial pure/component limit 0 passed / 2 failed and callback 1 passed / 1 failed; final 3 tests / 26 assertions, independently reviewed/rerun using isolated component fixtures. |
| Vector managed ownership/publication | Default adapter/service telemetry could follow another app's ambient emitter; failed publication needed cleanup ownership established first. | Captured app emitter through managed service/registry/default adapter, additive public emitCode option, cleanup registered before publication. Final vector family44pass/163assertions; independent synthetic ownership6pass/24assertions. No native index/provider opened. |
| AppShell header suppression | header:false/hide behavior disagreed between built-in shell variants. | Shared top-bar admission preserves the explicit hide contract; independent source/synthetic12pass/48assertions. |
| Icon forwarding and sidebar semantic colors | Persisted icon options were not forwarded; sidebar wrapped an already-complete semantic color in hsl(), producing an invalid shadow. | Correct option propagation and direct semantic variable consumption. Independent icon7pass/14assertions and actual isolated light/dark sidebar2pass/8assertions. No design/API redesign. |
| Progress scale and table initial filter | Progress did not follow the installed Radix maximum contract; the legacy table hook ignored its documented globalFilter option. | Maximum-aware progress and initial filter shorthand with explicit initial/controlled precedence. Independent progress5pass/33assertions and table filter/state10pass/30assertions. |
| Partial controlled table state | Explicit undefined facets replaced valid defaults, including pagination, and could crash rendering. | Merge only supplied defined facets; intentional empty values remain authoritative. Baseline4pass/2fail; final table/state/Progress17pass/65assertions independently rerun. |
| Tag batch, chart theme and tooltip label | One paste/drop lost tags against stale state; chart base colors missed light mode; tooltip labelKey did not select its configured heading. | One deduplicated bounded batch, separate base/dark CSS and configured heading resolution. Independent synthetic tag/theme6pass/14assertions; tooltip/theme4pass/16assertions. No dashboard redesign. |
| Inline text edit acceptance/lifetime | Same-tick duplicate edits, disabled queued blur and late unmounted callbacks could commit/notify; post-acceptance callback failures escaped. | Synchronous admission and mounted/generation guards; accepted save remains accepted while callback failures use safe frontend observability. Baseline0pass/4fail plus extra disabled case; final browser/keyboard6pass/17assertions independently reviewed/rerun. |
| New UI fixture package exposure | UI export wildcards could expose the newly added browser fixture modules. | Explicit null fixture pattern plus resolver regressions preserve ordinary public component imports; public UI export3pass independently run without importing/mounting fixtures. Archive qualification remains separate. |

Recorded runs use Bun 1.3.14 with env-file autoloading disabled and synthetic
fixtures. Counts overlap and must not be summed into a unique suite count.
No provider calls, app config evaluation or live database access occurred.

## Review State At The Original Audit Checkpoint

- UI and session corrections await final integrated independent diff review.
- Schema corrections passed independent source review, isolated type/runtime/form
  tests and global typecheck. Source/artifact qualification remains pending.
- Frontend hydration/navigation and AI agent facade corrections are complete
  with focused evidence above; exact artifact qualification remains pending.
- The vector managed telemetry/startup correction has completed its independent
  source review and synthetic ownership rerun above. Its fixtures never open
  native indexes; exact artifact qualification remains separate.

## Documentation Inaccuracies Corrected

- Internal MigrationArtifacts, createDataQueryPlugin and databases barrel were
  promoted to public imports; exact package routes now govern the inventories.
- Data Studio quotas/page budgets are constants, not constructor options;
  service constructor requires data and actor only.
- VectorScope supports filtered deleteWhere, not a fabricated ID delete method.
- Notifications/rooms use system DB; notification cleanup is hourly when a
  scheduler exists.
- Custom observability sinks compose with enabled defaults; Doctor
  observability checks exist.
- PDF unknown-key/scale behavior must follow the resolver, not guessed defaults.
- Current llms migration example omits required application --db; its Doctor
  introduction treats implemented checks as planned. New docs correct these;
  current entrypoints stayed untouched during the original audit. The later
  approved 2.4.1 handoff routes them to the new documentation tree.

## Missing Features Versus Defects

At the original source baseline, Guardian service-HMAC credentials,
org vector-store provisioning, live
model/pricing catalogs, database-backed providers, a generic workflow visual
editor and coding-agent MCP/hooks are not established current exports. Record
actual maturity and sourced product direction, not invented APIs.

## Whole-Set Gates Not Closed By A Focused Release

The plugin qualification record closes its own checks, not every correction
and example in this historical whole-platform table. Keep per-system review and
artifact evidence explicit rather than checking these boxes because `main` has
advanced or one package-consumer fixture passes.

- [ ] Every confirmed defect corrected and independently reviewed.
- [ ] Relevant regressions and updated typecheck pass.
- [ ] Corrected committed source/artifact frozen before qualification.
- [ ] Final guides reflect corrected contracts and truthful applicability.
