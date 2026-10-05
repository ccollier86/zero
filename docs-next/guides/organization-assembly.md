---
id: zero.guides.organization-assembly
type: tutorial
audience: [developer, agent]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: organization-assembly
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [multi, advanced-RBAC, Fabric tenant-database, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Assemble An Organization App Without Missing A Layer

[Guides index](./index.md) · [Documentation index](../index.md)

This recipe joins Guardian, Fabric, resources, lazy tables, Data Studio and
Storage Studio in one starter-relative layout. It is a wiring recipe for the
[package-mode starter](./first-app.md), not a second scaffolder or a claim that
a clean-room app/deployment was executed during this documentation pass.
Keep the starter's generated hydration/build/style files, package scripts,
theme and toast composition. Review changes before applying them to an existing app.

The chosen product model is an organization workspace with its own physical
database. The fixed notes table further restricts each note to its creator.
Data Studio's logical tables are organization-owned, and storage drives use
their own ownership/ACL rules. Those are deliberately different contracts.

## 1. Keep Shared Declarations Separate From Server Composition

Use this layout relative to the app root:

```text
zero.config.ts
db/
  schema.ts
  features.ts
  realm.ts
  resources.ts
  client-tables.ts
app/
  server.ts
  layout.tsx
  login/page.tsx
  register/page.tsx
  notes/page.tsx
  data/page.tsx
```

Browser pages import schema/client-tables, never zero.config, realm, resources or
the server feature factory. Realm imports have no app environment reads, listeners
or application startup. Every actor imports the same immutable admitted realm.

```ts
// db/schema.ts
import { defineTable, field } from '@zero/framework/schema';

export const notes = defineTable('notes', {
  owner_id: field.guardianUser(),
  body: field.text({ required: true, maxLength: 2000 }),
}, { sync: 'lazy' });
```

guardianUser requests a minimal local FK anchor, not a copied password/profile or
a permission grant. There is no tenant_id column here because trusted Fabric
selection identifies the tenant database. The logical resource realm remains
mandatory. See [Guardian references](../backend/schema/guardian-references.md).

```ts
// db/features.ts
import { createDataStudioFeature } from '@zero/framework/server';

export const studio = createDataStudioFeature();
```

```ts
// db/realm.ts
import {
  composeDatabaseRealm, defineDatabaseRealmContribution,
} from '@zero/framework/server';
import { notes } from './schema';
import { studio } from './features';

const notesContribution = defineDatabaseRealmContribution({
  name: 'notes',
  version: '1',
  tables: { notes: notes.serverTable },
});

export const appRealm = composeDatabaseRealm({
  name: 'organization-example',
  version: '1',
  contributions: [notesContribution, studio.realmContribution],
});
```

Contributing a schema to the realm and registering its app table are both
necessary: neither a client declaration nor a frontend component provisions a
file by itself. Version changes require the normal
[realm/migration procedure](../backend/fabric/realms.md), not editing a live file.

## 2. Compose Tenant, Permission And Row Ownership

```ts
// db/resources.ts
import {
  allOf, authorizationPolicy, defineResource, ownerPolicy, tenantRealm,
} from '@zero/framework/resources';
import { notes } from './schema';

const owner = ownerPolicy({ userField: 'owner_id' });
const read = allOf(
  authorizationPolicy({ tenant: 'required', permission: 'notes:read' }),
  owner,
);
const write = allOf(
  authorizationPolicy({ tenant: 'required', permission: 'notes:write' }),
  owner,
);

export const notesResource = defineResource({
  table: notes,
  exposure: 'all',
  realm: tenantRealm(),
  fields: {
    read: ['id', 'owner_id', 'body'],
    create: ['body'],
    update: ['body'],
    filter: ['id', 'body'],
    sort: ['id', 'body'],
  },
  policy: { list: read, get: read, create: write, update: write, delete: write },
});
```

The tenant realm binds the current organization independently of these policy
branches. The permission check and owner constraint are ANDed, not alternative
ways to pass. ownerPolicy stamps the creator at create and keeps ownership
immutable; client fields admit body, not a caller-selected owner_id.
The same managed declaration governs HTTP queries/CRUD and Sync.
See [policy composition](../backend/resources/policy-composition.md).

## 3. Register The Complete Server Feature Bundles

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';
import {
  STORAGE_STUDIO_PERMISSION_REGISTRY, STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT,
} from '@zero/framework/storage';
import { notes } from './db/schema';
import { studio } from './db/features';
import { appRealm } from './db/realm';
import { notesResource } from './db/resources';

export const config = defineZeroConfig({
  port: 3000,
  appDir: './app',
  db: { mode: 'file', path: './data/app.db' },
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  tables: { notes, ...studio.appTables },
  resources: [notesResource, ...studio.resources],
  auth: {
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.INSTALLATION_BOOTSTRAP_SECRET,
    },
    registration: { mode: 'public' },
    tenancy: {
      mode: 'multi',
      creation: { mode: 'authenticated' },
    },
    authorization: {
      mode: 'advanced',
      permissions: {
        'notes:read': { scope: 'tenant', label: 'Read own notes' },
        'notes:write': { scope: 'tenant', label: 'Write own notes' },
        ...studio.permissions,
        ...STORAGE_STUDIO_PERMISSION_REGISTRY,
      },
      roles: {
        builder: {
          label: 'Builder',
          permissions: [
            'notes:read', 'notes:write',
            ...studio.roleFragments.manager.permissions,
            ...(STORAGE_STUDIO_MANAGER_ROLE_FRAGMENT.permissions ?? []),
          ],
        },
      },
    },
  },
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-files',
    tenantIsolation: 'tenant-database',
    realm: appRealm,
    actors: {
      launch: {
        kind: 'source',
        entrypoint: new URL('./app/server.ts', import.meta.url),
      },
    },
  },
  storage: {
    studio: { enabled: true, organizationDrives: true, personalDrives: false },
  },
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register'],
  loginPath: '/login',
  registrationPath: '/register',
  postLoginPath: '/notes',
});

export default config;
```

The publicPaths list deliberately includes only the two account pages supplied
here. Add actual recovery/verification/invitation landing pages if enabling those
flows; an explicit list does not inherit every default page automatically.

INSTALLATION_BOOTSTRAP_SECRET is an app-chosen server environment binding. Supply
an operator-held secret satisfying the [bootstrap contract](../backend/guardian/bootstrap.md)
(at least 32 characters) without checking its value into code or browser config.
The packaged registration flow adapts to first-owner bootstrap. In multi mode
that ceremony creates the protected Administration Organization, not a customer
organization that happens to have an admin label.

Builder is an ordinary tenant-scoped app role: it can be assigned in customer or
Administration workspaces without granting platform/application permissions.
Role definitions do not assign themselves to every registered account. Owners
grant Builder through the supported membership controls. Protected owner and
platform operator authority remain separate.

Data Studio needs all of its official app tables, resources, realm contribution
and permissions. Managed createApp mounts its router after admission; do not
mount another copy. Storage Studio's manager fragment permits catalog,
provisioning and management, not permanent drive deletion. Object access still
obeys engine ACLs; management permissions are not a universal blob-read grant.

## 4. Branch Into The Actor Before App Startup

```ts
// app/server.ts
import { runDatabaseActorIfRequested } from '@zero/framework/server';
import { appRealm } from '../db/realm';

if (!await runDatabaseActorIfRequested({ realm: appRealm })) {
  const [{ createApp }, { default: config }] = await Promise.all([
    import('@zero/framework/server'),
    import('../zero.config'),
  ]);
  const app = await createApp(config);
  app.listen(config.port);
}
```

Do not statically import zero.config before that check. Actor children need only
their realm; they must not read app secrets, initialize adapters or start another
HTTP server. Source launch uses the same entry file and its explicit environment
allowlist. See [actor launch](../backend/fabric/actors.md).

## 5. Supply One Browser-Safe Table Catalog And Provider

```ts
// db/client-tables.ts
import { DATA_STUDIO_CLIENT_TABLES } from '@zero/framework/data-studio';
import { notes } from './schema';

export const clientTables = {
  notes: notes.clientTable,
  ...DATA_STUDIO_CLIENT_TABLES,
};
```

Storage's SDK/control plane is provided by the integrated client; don't add raw
storage system tables to this app Sync catalog. Browser tables describe transport
shape, not permission or a second schema migration.

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import { AppProvider } from '@zero/framework/react';
import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { clientTables } from '../db/client-tables';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="organization-example-theme">
      <AppProvider
        url={typeof window === 'undefined' ? '' : window.location.origin}
        tables={clientTables}
        auth
      >
        <div className="min-h-screen bg-background text-foreground">{children}</div>
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
```

This same-origin browser setup matches the running server. SSR uses the provider's
server fallback rather than opening a socket. Keep the starter's generated
hydration entry and managed stylesheet pipeline; replacing this layout does not
replace those build files.

## 6. Use The Packaged Public Account Flows

```tsx
// app/login/page.tsx
import { AuthLayout, LoginForm } from '@zero/framework/components/auth';

export default function LoginPage() {
  return (
    <AuthLayout appName="Organization example">
      <LoginForm showForgotPassword={false} registerHref="/register"
        onSuccess={() => window.location.assign('/notes')} />
    </AuthLayout>
  );
}
```

```tsx
// app/register/page.tsx
import { AuthLayout, RegisterForm } from '@zero/framework/components/auth';

export default function RegisterPage() {
  return (
    <AuthLayout appName="Organization example">
      <RegisterForm loginHref="/login"
        onSuccess={() => window.location.assign('/notes')} />
    </AuthLayout>
  );
}
```

The forms coordinate MFA/tenant/onboarding continuation and call onSuccess only
after session completion. Registration policy and bootstrap authority remain
server-owned. For a larger app, use the adaptive
[Guardian control plane](../frontend/guardian/index.md) for memberships,
role assignment, invitations and authorized workspace switching.

## 7. Render Explicit Server Queries And Organization Controls

```tsx
// app/notes/page.tsx
import { DataTable } from '@zero/framework/react';
import { notes } from '../../db/schema';

export default function NotesPage() {
  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-semibold">My workspace notes</h1>
      <DataTable schema={notes.schema}
        source={{ type: 'server', table: 'notes' }}
        columns={['body']} editable={['body']}
        searchable={{ fields: ['body'], placeholder: 'Find notes…' }}
        sortable paginated={{ pageSize: 20 }} />
    </main>
  );
}
```

An explicit server source loads the lazy table's query membership; an empty
useCollection cache is not proof that a lazy database table is empty. Search,
sort and pagination go through the authenticated SDK to the admitted data API.
Writes still use server owner/permission checks. This page edits existing notes.
For creation, compose [AutoForm](../frontend/forms/auto-form.md) with body-only
input and an awaited [ResourceClient create](../frontend/sdk/resources.md),
not a caller-picked owner field. [User-owned records](./user-owned-records.md)
explains the server stamping and the same lazy-table transport choice.

```tsx
// app/data/page.tsx
import { DataStudio } from '@zero/framework/react';
import { StorageStudioManagement } from '@zero/framework/components/storage';

export default function WorkspaceDataPage() {
  return (
    <main className="space-y-8 p-4">
      <DataStudio title="Workspace tables"
        description="Organization-owned logical tables and records." />
      <section aria-label="Workspace storage" className="h-[40rem]">
        <StorageStudioManagement />
      </section>
    </main>
  );
}
```

These components adapt to live capabilities in the selected organization. They
do not themselves enable a backend feature, bypass a membership boundary or
reconcile an unresolved provisioning outcome by inventing success.

## Verification Boundary And Next Steps

The documentation check compiles these actual modules together in memory against
public source imports. It does not execute configuration, bootstrap, app startup,
actors, provider calls, migrations or storage. This is not a clean-room runtime,
package/deployment or visual-control-plane certification.

At the first-draft handoff, the focused platform example check passed with these
twelve modules and the three [user-owned modules](./user-owned-records.md)
assembled at their actual relative TS/TSX paths. Independent source review also
checked the file joins and authority/feature boundaries. Those checks establish
the inspected recipe's type/source wiring, not that it was deployed or bootstrapped.

Use a deliberately disposable app when you later run the recipe. Bootstrap,
register/join a second organization, assign Builder, create a note through the
accepted resource path, refresh/query it, test denied cross-owner/cross-organization
operations and observe tenant provisioning/readiness. Exercise Administration
app-only and mixed-role members separately. Use the existing readiness,
idempotency and standard error surfaces rather than retrying an unknown commit.

- [Organization concepts](./organization-app.md) explains the product model.
- [Lazy user-owned records](./user-owned-records.md) explains stamping and transport.
- [Data Studio installation](../backend/data-studio/installation.md) owns feature admission.
- [Storage Studio installation](../backend/storage/studio-installation.md) owns drive setup.
- [Verification](./verification.md) distinguishes type checks from real app behavior.
