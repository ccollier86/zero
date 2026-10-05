---
id: zero.documentation.experience-reader-review
type: operations
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Experience And Storage Reader Walkthrough

[Audit index](./index.md) · [Documentation index](../../index.md)

This is a source-backed **dry walkthrough**, not execution of a sample app,
config, bootstrap, database migration or browser session. A reviewer followed
the actual reader navigation and checked public contract choices against the
working source. The source baseline is 2.1.1 at
`a3a5f726768dac890f241a3899c0a1acb66265d9`, plus recorded approved fixes.
It does not complete installed-package, deployment or broad security gates.

## Tasks And Reader Decisions

| Hypothetical task | Actual documentation path | Decision available to reader |
| --- | --- | --- |
| Single-workspace app with user-owned records | [Mode choice](../../guides/choose-modes.md) → [user-owned records](../../guides/user-owned-records.md) → [Guardian references](../../backend/schema/guardian-references.md) → [resource policies](../../backend/resources/policies.md) | Canonical users remain system-owned; local minimal FK anchors do not authorize records. Single/simple and single/advanced remain independent of physical topology. |
| Organization app using separate Fabric files | [Organization guide](../../guides/organization-app.md) → [Fabric](../../backend/fabric/index.md) → [Guardian tenancy](../../backend/guardian/tenancy.md) → [data planes](../../concepts/data-planes.md) | Resolve organization from live authority, provision before use, preserve user/membership references; do not put an arbitrary browser tenant ID into a file path. |
| App-only Administration member plus platform operator role | [Adaptive people UI](../../frontend/guardian/people-control-plane.md) → [tenant administration](../../backend/guardian/tenant-administration.md) → [RBAC](../../backend/guardian/rbac.md) → [platform control plane](../../backend/guardian/control-plane.md) | Tenant app role and application/platform permissions remain distinct; advanced mixed-role membership is possible. Owner continuity, delegation and current scope still apply. |
| Organization manager provisioning a workflow-file drive | [Storage UI](../../frontend/storage/index.md) → [Studio installation](../../backend/storage/studio-installation.md) → [permissions](../../backend/storage/studio-permissions.md) → [native wrapper](../../frontend/storage/storage-studio-management.md) | Enable server policy and explicitly declare/grant permissions; New Drive uses current capabilities. Control manage is not private-byte ACL admin. |
| Customize inspector/actions without reimplementing auth | [Controller](../../frontend/storage/controller-contract.md) → [composition hook](../../frontend/storage/use-storage-studio-management.md) → [inspector](../../frontend/storage/storage-studio-inspector.md) → [action bar](../../frontend/storage/storage-studio-action-bar.md) | Keep SDK result/authority fences; details/ACLs stay in right pane and compact operations in bottom bar. Slot nullish fallback is explicit. |
| Existing drive UI choosing whether to adopt Studio | [StorageManagement](../../frontend/storage/storage-management.md) → [legacy drive list](../../frontend/storage/storage-drive-list.md) → [native Studio](../../frontend/storage/storage-studio-management.md) | A shared modern layout does not silently select native provisioning. Controller or native wrapper choice is explicit; no automatic mode/data migration is promised. |
| Verified server credential using organization Storage/Fabric | [Machine services](../../backend/runtime/machine-services.md) → [request authority](../../backend/storage/request-authority.md) → [SDK integration](../../frontend/storage/sdk-integration.md) | Projection does not authenticate a credential. Trusted adapter supplies server-derived scope and both live fences; no fabricated browser session or raw setup escape hatch. |
| Desktop/extension auth and cross-device account ceremony | [Native UI](../../frontend/guardian/native-ui.md) → [native family](../../backend/native-auth/index.md) → [native configuration](../../backend/native-auth/configuration.md) | Exact callback/PKCE and protected credential storage; public client IDs are not tenant selectors. Independent Rust/extension packages remain private preview boundaries, not released registry packages. |
| PDF preview/render and optional authorized persistence | [Storage preview](../../frontend/storage/storage-file-preview.md) → [capabilities](../../backend/storage/capabilities.md) → [PDF](../../backend/pdf/index.md) → [PDF storage](../../backend/pdf/storage.md) | Signed URL is a temporary capability; text/markup is not executed; PDF signature admission is not conformance or full DNS/network sandbox certification. |

## Corrections Produced By This Review Stream

The walkthrough/code audit found real runtime problems and did not convert
them into documentation limitations. Their original reproductions and final
independent checks are in the [findings ledger](./findings.md): notification
input, room metadata/capacity, token deadlines/arithmetic, bounded observability,
PDF app ownership/resource/publication, Storage drop-event rejection,
same-target/component-lifetime state, and settings validation/event failure.

Source-example checking also corrected an invalid Notification example that
used nonexistent `client.post`; it now uses the public authenticated
`client.fetch` body/method contract. The Guardian preference example now retains
pending/error with the packaged async action hook and observes its event-owned
rejection. All 50 actual TS/TSX fences in this stream's Guardian/Storage/service
families compile in memory against public source exports.

## Review Boundaries And Remaining Evidence

- Backend Sync and Vector manuals received independent defaults/public-boundary/
  lifecycle review; minor precision notes were returned to their owner.
- Storage/Data Studio backend authority/config/lifecycle pages received a focused
  Guardian-boundary review, not a claim that every backend paragraph/provider
  adapter or deployed lifecycle was independently certified.
- Every public Storage component/hook/helper has a substantive draft home and
  navigation; placement is not a substitute for prop correctness or interaction.
- Real running-app task completion, exact archive installation, broad assistive
  technology/browser validation and documentation publication are not performed.
- No app/live data/deployment/current documentation/active agent cutover occurred.

These tasks are feasible to trace without conversation history and preserve the
right trust boundaries. The next verification stage should execute selected
tasks only in explicitly authorized disposable app fixtures and against the
approved package identity; it must not turn this dry review into a production
readiness claim.
