# Platform Roadmap — Build Plan

Everything needed to take the platform from "powerful framework" to "complete application platform with AI-native development."

---

## Phase 1: UI Expansion

### 1A: Missing Primitives

Fill every gap so developers never need an external component library.

**Layout & Navigation**
- Tabs (animated, vertical/horizontal variants)
- Breadcrumbs
- Sidebar (collapsible, nested groups, badges)
- Stepper / Progress Steps
- Resizable Panels (drag handles, persist sizes via useServerState)
- Drawer / Sheet (already have — verify animated variants)
- Navbar (responsive, sticky, transparent-on-scroll)

**Data Display**
- Timeline (vertical, alternating, with icons)
- Tree View (expandable, checkable, drag-to-reorder)
- Carousel / Slider (touch support, autoplay, indicators)
- Image Gallery (lightbox, zoom, grid/masonry)
- Code Block (syntax highlighting, copy button, line numbers)
- Diff Viewer (side-by-side, inline, for text and code)
- JSON Viewer (collapsible, searchable)
- Markdown Renderer

**Feedback & Overlay**
- Alert / Banner (dismissible, with actions)
- Progress Bar (determinate, indeterminate, circular)
- Spinner / Loading (skeleton already exists — add spinner variants)
- Confirm Dialog (already have useConfirm — verify animated)
- Tooltip (already have — verify rich content support)
- Popover (already have — verify positioning engine)
- Tour / Onboarding Spotlight (step-through, highlight elements)

**Input & Forms**
- Color Picker
- Slider / Range Input
- Rating (stars, hearts, custom icons)
- Pin Input / OTP (already have OTPInput — verify)
- File Upload / Dropzone (ties into Storage API later)
- Rich Text Editor (Tiptap or similar, minimal config)
- Autocomplete (distinct from Combobox — inline suggestions)
- Transfer List (dual-list picker)
- Sortable List (drag and drop reorder)

**Data Visualization**
- Sparkline (inline mini charts)
- Chart primitives (bar, line, pie, area — lightweight, no D3 dependency)
- Stat Card variants (trend arrows, sparklines, comparison)
- KPI / Metric display

### 1B: Blocks

Pre-composed, drop-in page sections. Each block is a complete, styled, responsive section.

**Marketing / Landing**
- Hero sections (5+ variants: centered, split, with image, video background, animated)
- Feature grids (icon + text, screenshot + text, alternating rows)
- Pricing tables (toggle monthly/annual, highlighted plan, comparison matrix)
- Testimonials (carousel, grid, single featured quote)
- FAQ accordion
- CTA sections (newsletter signup, waitlist, download)
- Footer (multi-column links, social icons, newsletter)
- Navbar / Header (logo + nav + auth buttons + mobile menu)
- Logo cloud / Partner strip
- Stats / Numbers section (animated counters)

**Application**
- Settings page (grouped sections, form fields, save/cancel)
- Profile page (avatar, info fields, password change, danger zone)
- Dashboard shell (sidebar + header + content area, responsive)
- Empty states (illustration + message + CTA)
- Error pages (404, 500, maintenance, with illustrations)
- Onboarding flow (multi-step, progress indicator, skip/back)
- Activity feed / Timeline
- Notification center (dropdown + full page)
- Command palette (Cmd+K, search across app)
- Data import wizard (upload CSV, map columns, preview, confirm)

### 1C: Domain Components

Complex, feature-rich components that save days of work.

**Full Calendar**
- Month, week, day, agenda views
- Drag to create / resize events
- Recurring events
- Color-coded categories
- Integrates with useCollection for real-time event sync
- Mobile-responsive (swipe between days/weeks)

**File Browser**
- Grid and list views
- Breadcrumb navigation
- Preview panel (images, PDFs, text, code)
- Upload with drag-and-drop
- Integrates with Storage API (Phase 2)
- Context menu (rename, delete, move, download)

**Kanban Board**
- Drag-and-drop between columns
- Collapsible columns
- Card customization (avatars, labels, due dates)
- Integrates with useCollection for real-time updates
- WIP limits per column
- Swimlanes

**Data Grid (Advanced)**
- Virtual scrolling for 10k+ rows
- Column pinning, resizing, reordering
- Row grouping and aggregation
- Cell-level editing with validation
- Export (CSV, Excel)
- Extends existing DataTable

**Chat / Messaging**
- Message list with auto-scroll
- Typing indicators (via useEphemeral)
- Read receipts
- File/image attachments
- Message reactions
- Thread/reply support
- Integrates with Rooms + Storage API

---

## Phase 2: Backend Features

### 2A: Storage API (Files / Blobs)

Simple, in-process file storage. Local disk by default, S3-compatible as optional backend.

**Developer API**
```ts
import { createStoragePlugin, getStorage } from '@platform/server';

// Server setup
app.use(createStoragePlugin({
  driver: 'local',            // 'local' | 's3'
  path: './uploads',          // local disk path
  maxFileSize: '50mb',
  allowedTypes: ['image/*', 'application/pdf', 'text/*'],
}));

// Upload
const file = getStorage();
const result = await file.put('avatars/user-123.jpg', buffer, {
  contentType: 'image/jpeg',
  metadata: { uploadedBy: userId },
});

// Read
const stream = await file.get('avatars/user-123.jpg');
const url = file.url('avatars/user-123.jpg');  // signed URL

// Delete
await file.delete('avatars/user-123.jpg');

// List
const files = await file.list('avatars/', { limit: 50 });
```

**Client SDK**
```ts
const client = useClient();

// Upload from browser
const result = await client.upload('/api/storage/upload', fileInput.files[0]);

// Get URL
const url = client.storageUrl('avatars/user-123.jpg');
```

**React Hook**
```tsx
const { upload, uploading, progress, error } = useUpload();

<input type="file" onChange={(e) => upload(e.target.files[0], {
  path: 'avatars/',
  onComplete: (result) => collection.update(userId, { avatar: result.key }),
})} />
```

### 2B: Vector Search

Implemented as an opt-in local zvec-backed vector store. See
[Vector Store](./vector.md) for the current API.

**Developer API**
```ts
import { getVectorStore } from '@platform/server';

const vec = getVectorStore();
if (!vec) throw new Error('Vector store is not enabled.');

// Store embeddings
await vec.upsert('documents', {
  id: 'doc-123',
  vector: embedding,
  text: 'My document text',
  metadata: { title: 'My Doc', category: 'legal' },
});

// Search
const results = await vec.query('documents', {
  vector: queryEmbedding,
  topK: 10,
  filter: { category: 'legal' },
  minScore: 0.7,
});
// Returns [{ id, score, metadata }]

// Delete
await vec.delete('documents', 'doc-123');
```

**Use Cases**
- Semantic search across app content
- RAG (retrieve context for AI prompts)
- Recommendation engines
- Similar item detection
- Document clustering

### 2C: Webhooks — Outbound

Event-driven HTTP delivery. When things happen in the app, notify external services.

**Developer API**
```ts
import { createWebhookPlugin, getWebhooks } from '@platform/server';

app.use(createWebhookPlugin({ db: lazyDB }));

const hooks = getWebhooks();

// Register a webhook
hooks.register({
  name: 'notify-slack',
  url: 'https://hooks.slack.com/services/...',
  events: ['client.created', 'drug_screen.positive_confirmed'],
  secret: 'whsec_...',       // HMAC signing
  retries: 3,
  timeout: 10000,
});

// Emit events from anywhere
hooks.emit('client.created', {
  clientId: 'abc',
  name: 'John Doe',
  timestamp: Date.now(),
});
```

**Built-in Events**
- Table mutations: `{table}.created`, `{table}.updated`, `{table}.deleted`
- Auth: `auth.login`, `auth.register`, `auth.logout`
- Custom events: anything the developer emits

**Features**
- HMAC signature verification (like Stripe's webhook signing)
- Automatic retries with exponential backoff
- Delivery log with status tracking
- Admin API to list, pause, test, replay webhooks
- Dead letter queue for failed deliveries

### 2D: Webhooks — Inbound

Receive webhooks from external services with validation and routing.

**Developer API**
```ts
// File-based route: app/api/webhooks/stripe/route.ts
import { verifyWebhook } from '@platform/server';

export async function POST({ request }: LoaderContext) {
  const event = await verifyWebhook(request, {
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    provider: 'stripe',       // knows Stripe's signing scheme
  });

  switch (event.type) {
    case 'payment_succeeded':
      // handle
      break;
    case 'subscription_cancelled':
      // handle
      break;
  }

  return json({ received: true });
}
```

**Built-in Provider Support**
- Stripe (signature verification)
- GitHub (signature verification)
- Slack (URL verification + signing)
- Generic HMAC
- Custom verification functions

### 2E: Analytics and Error Drains

Don't build dashboards. Pipe structured events out to whatever the user already uses.

**Developer API**
```ts
import { createDrainPlugin } from '@platform/server';

app.use(createDrainPlugin({
  drains: [
    {
      name: 'errors',
      type: 'webhook',
      url: 'https://sentry.io/api/...',
      events: ['error.*'],
      batch: { size: 10, interval: 5000 },
    },
    {
      name: 'analytics',
      type: 'webhook',
      url: 'https://api.datadog.com/...',
      events: ['analytics.*'],
      headers: { 'DD-API-KEY': process.env.DD_KEY },
      batch: { size: 50, interval: 10000 },
    },
    {
      name: 'audit-log',
      type: 'table',          // write to local SQLite table
      events: ['auth.*', '*.created', '*.deleted'],
    },
  ],
}));
```

**Auto-captured Events**
- Errors: uncaught exceptions, unhandled rejections, route errors
- Performance: request duration, DB query time, WebSocket latency
- Auth: login, logout, failed attempts, token refresh
- Data: mutation counts per table per minute

**Custom Events**
```ts
import { track } from '@platform/frontend';

track('analytics.page_view', { path: '/dashboard', userId });
track('analytics.feature_used', { feature: 'bulk-import', count: 150 });
```

---

## Phase 3: Claude Code Enhancement System

Make Claude Code natively understand the platform — like giving it the instruction manual and every piece in the set before it starts building.

### 3A: Platform Knowledge Package

A set of files that get installed into the project and loaded into Claude Code's context.

**CLAUDE.md (auto-generated per project)**
```markdown
# Platform Project

This project uses the Platform SDK. Key conventions:

## Architecture
- Single Bun server with in-process SQLite
- Real-time sync via WebSocket (useCollection, useServerState, useEphemeral)
- File-based routing in app/ directory
- Schema-driven: defineTable() produces server + client + validation

## Available Hooks
[auto-generated list from platform exports]

## Available Components
[auto-generated list with brief descriptions]

## Available Blocks
[auto-generated list with descriptions]

## Patterns
- Full sync tables: useCollection('tableName')
- Lazy sync tables: useLazyCollection('tableName', filters?, opts?)
- Auth: useAuth() for state, useRequireAuth() for guards
- Forms: AutoForm for schema-driven, useForm for custom
- Data tables: DataTable with schema prop
- Navigation: file-based routes, Link component, useRouter()

## Rules
- Never install external UI libraries (everything is built in)
- Never use fetch() directly (use client.get/post/patch/delete)
- Never create REST endpoints for synced data (use collections)
- Never store UI state in collections (use useServerState)
- Never use emojis in code or UI
- Use platform animated icons, never emoji substitutes
```

**Memory Files**
```
.claude/memory/
  platform-components.md    — full component catalog with props
  platform-hooks.md         — every hook with signatures and examples
  platform-blocks.md        — block catalog with visual descriptions
  platform-patterns.md      — common patterns and anti-patterns
  platform-schema.md        — defineTable, field types, validation
  platform-backend.md       — plugins, storage, vectors, webhooks
  platform-icons.md         — animated icon catalog from animate-ui
```

### 3B: MCP Tools

Custom MCP tools that give Claude Code direct platform capabilities.

**Scaffold Tools**
```
platform_create_table     — generates defineTable() + schema file from description
platform_create_page      — generates a page.tsx with layout, hooks, components
platform_create_block     — scaffolds a block from the block catalog
platform_create_api       — generates a file-based API route
platform_create_plugin    — scaffolds a server plugin with lifecycle hooks
```

**Introspection Tools**
```
platform_list_tables      — shows all defined tables with fields and sync mode
platform_list_routes      — shows all file-based routes
platform_list_components  — searchable component catalog with props
platform_list_blocks      — searchable block catalog
platform_list_icons       — searchable animated icon catalog
platform_show_schema      — displays a table's full schema with types
```

**Validation Tools**
```
platform_check_imports    — verifies all imports resolve to platform exports
platform_check_hooks      — validates hook usage patterns
platform_check_schema     — validates schema definitions
platform_typecheck        — runs type checking on the project
```

### 3C: CLI Enhancement Scripts

Shell scripts and hooks that run automatically during development.

**Post-scaffold Hook**
When Claude creates a new file, automatically:
- Validate imports against platform exports
- Check schema references exist
- Verify route doesn't conflict with existing routes
- Run type check on the new file

**Pre-commit Hook**
- Schema validation (all defineTable calls valid)
- Import check (no external UI libs when platform has it)
- Bundle size check (flag if file > 500 lines)

**Dev Commands**
```bash
platform init              # scaffold new project with CLAUDE.md + memory files
platform add page <name>   # interactive page scaffolding
platform add table <name>  # interactive table scaffolding
platform add block <name>  # pick from block catalog
platform doctor            # check project health, missing deps, config issues
platform update            # pull latest platform files, run migration checks
```

### 3D: The Assembly System

Claude Code treats the platform like a set where every piece is known, every connection point is defined, every valid assembly has been built before.

**Component Registry**
A machine-readable catalog of every component, hook, block, and pattern:

```json
{
  "components": {
    "DataTableView": {
      "import": "import { DataTableView } from '@platform/frontend'",
      "props": {
        "schema": { "type": "SchemaDescriptor", "required": true },
        "collection": { "type": "string" },
        "data": { "type": "T[]" },
        "columns": { "type": "string[]" },
        "editable": { "type": "string[]" },
        "searchable": { "type": "boolean" },
        "sortable": { "type": "boolean" },
        "actions": { "type": "RowAction[]" }
      },
      "tags": ["data", "table", "crud", "inline-edit"]
    }
  },
  "icons": {
    "animated": ["list of all animate-ui icons with names and categories"]
  },
  "patterns": {
    "lazy-table-page": {
      "description": "Page that displays a lazy-synced table with CRUD",
      "requires": ["DataTableView source lazy", "MasterDetailView or DataTableView"],
      "template": "..."
    }
  }
}
```

**Assembly Rules**
Machine-readable rules for what connects to what:

- `MasterDetailView collection="table"` is the fastest full-sync wiring path.
- `DataTableView collection="table"` is the fastest full-sync table wiring path.
- `DataTableView source={{ type: 'lazy', table }}` is the fastest lazy `/api/data` wiring path.
- `useCollection` returns `CollectionResult` — pass `.data` to `DataTableView.data` or `MasterDetailView.data` when custom data ownership is needed.
- `defineTable().schema` — pass to `AutoForm.schema`, `DataTableView.schema`, `MasterDetailView.schema`
- Lazy tables must use `useLazyCollection` not `useCollection`
- `useServerState` for UI preferences, `useCollection` for domain data, `useEphemeral` for transient shared state
- File at `app/foo/page.tsx` = route `/foo`
- File at `app/api/foo/route.ts` = API at `/api/foo`
- Use animated icons from `@platform/frontend/icons` by default, never emojis for actions/states/navigation, and use raw `lucide-react` only when Zero does not ship the needed animated icon.

**Pre-built Assemblies**
Complete, tested combinations as starting points:

- CRUD page with master-detail layout
- Dashboard with stat cards + data tables
- Settings page with grouped form sections
- Intake wizard with multi-step form
- Report page with tabs and charts
- Admin user-management organism
- Chat room with real-time messages
- Calendar view with event management
- File browser with upload/preview
- Kanban board with drag-and-drop

Each assembly includes the exact files, imports, hooks, components, and patterns needed. Claude doesn't figure it out — it looks it up.

---

## Phase 4: Web Platform

### 4A: Excalidraw Sketch-to-App

**Flow**
1. User draws rough layout in Excalidraw canvas
2. User describes the app in natural language alongside the sketch
3. System analyzes sketch structure (boxes = components, labels = content, arrows = navigation)
4. AI maps sketch regions to platform blocks and components
5. Generates real, running preview using actual platform components
6. Faker.js fills everything with contextually appropriate demo data
7. User iterates — adjust sketch, refine description, see changes in seconds

**Faker Integration**
Smart, context-aware fake data:
- Table labeled "Clients" generates realistic client records with plausible data distributions
- Calendar component generates events spread across the current month
- Chart component generates trend data that tells a plausible story
- Relationships maintained — child records reference valid parent IDs
- AI configures Faker based on the domain (medical app gets medical terms, CRM gets business terms)

**Sandbox Environment**
- Full platform running in-browser or in a lightweight container
- Real WebSocket connections, real reactive updates
- User can interact with the demo — click, filter, sort, create records
- All backed by Faker data, all running on the real platform code

### 4B: Iterate and Refine

- Drag to rearrange sections in the preview
- Click a component to swap variants (different hero style, different table layout)
- Natural language refinements: "make the sidebar collapsible" / "add a dark mode toggle" / "show attendance rate as a percentage"
- Side-by-side: sketch on left, live preview on right
- Version history — go back to any previous iteration

### 4C: Export and Deploy

**Export Options**
- Download as project (full source code, ready to develop locally)
- Docker image (single binary, single process, single port)
- Deploy to Platform hosting (one click)

**Docker Image**
- Single Bun binary + app code + SQLite
- AI pre-configures RAM vs disk per table based on expected data volume
- Preallocated SQLite for disk-backed tables
- Health check endpoint included
- Graceful shutdown handling
- Minimal image size — no external services needed

**Platform Hosting**
- Zero config deployment
- Custom domains
- Auto-TLS
- Monitoring via drain events
- One-click rollback

---

## Phase 5: Serverless-Style Functions

Compile individual functions to standalone binaries for on-demand execution.

**Developer Experience**
```
app/
  functions/
    send-report.ts        compiled to standalone binary
    process-payment.ts    compiled to standalone binary
    generate-invoice.ts   compiled to standalone binary
```

**How It Works**
1. Developer writes functions in `app/functions/`
2. Compiler builds each to a standalone Bun binary
3. Router maps incoming requests to the right binary
4. Binary spins up on demand (millisecond startup with Bun)
5. Executes, returns response, optionally stays warm
6. Cold functions killed after idle timeout

**Resource Efficiency**
- No idle processes for rarely-used functions
- Main app server stays lean
- Hot pooling for frequently called functions
- Memory isolated — one function crashing doesn't take down the app

---

## Implementation Priority

**Now (foundation)**
1. Eden Treaty — typed routes (in progress)
2. Storage API — files are in every app
3. Missing primitives — fill gaps

**Next (power features)**
4. Domain components — calendar, file browser, kanban, chat
5. More blocks — marketing + application blocks
6. Vector search
7. Webhooks in/out
8. Analytics/error drains

**Then (AI layer)**
9. Claude Code enhancement package (CLAUDE.md, memory files, MCP tools)
10. Component/block/icon registry (machine-readable catalog)
11. CLI tooling (platform init/add/doctor)
12. Assembly system with pre-built patterns

**Finally (product)**
13. Excalidraw web platform with Faker integration
14. Docker image export
15. Platform hosting
16. Serverless functions compiler

Each phase builds on the last. The platform gets more capable, the AI gets smarter about using it, the web platform makes it accessible to everyone.
