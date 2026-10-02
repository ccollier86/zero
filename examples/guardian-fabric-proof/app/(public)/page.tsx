import { ArrowRight, Check, Layers } from '@zero/framework/icons';
import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { FeaturesSection, Hero, ResizableNavbar } from '@zero/framework/react';

export const meta = {
  title: 'Guardian + Fabric + Torrent Proof',
  description: 'Guardian authority, isolated tenant data, realtime collaboration, and durable workflows.',
};

const guarantees = [
  {
    id: 'guardian',
    iconName: 'lock' as const,
    title: 'Guardian is the authority',
    description: 'Sessions, memberships, roles, permissions, and API keys are checked on the server for every protected operation.',
  },
  {
    id: 'fabric',
    iconName: 'layers' as const,
    title: 'One database per customer workspace',
    description: 'Task rows have no tenant discriminator. Fabric selects an actor-owned SQLite database from trusted tenant authority.',
  },
  {
    id: 'reactive-db',
    iconName: 'wifi' as const,
    title: 'Realtime by default',
    description: 'The task board subscribes through ReactiveDB Sync while writes travel through policy-protected Resource actions.',
  },
  {
    id: 'torrent',
    iconName: 'radio' as const,
    title: 'Durable orchestration',
    description: 'Torrent persists versioned graphs and human interactions while a bound activity writes only to the authorized tenant data plane.',
  },
] as const;

/** Public product and architecture overview. */
export default function LandingPage() {
  return (
    <div className="zero-public-page bg-public-background" data-zero-page="public">
      <ResizableNavbar
        brand={{
          label: 'Guardian + Fabric + Torrent',
          href: '/',
          mark: (
            <span className="grid size-9 place-items-center rounded-lg bg-public-accent text-public-accent-foreground shadow-[var(--public-shadow-floating)]">
              <Layers className="size-5" aria-hidden="true" />
            </span>
          ),
        }}
        items={[
          { label: 'Architecture', href: '#architecture' },
          { label: 'Acceptance', href: '#acceptance' },
        ]}
        actions={[
          { label: 'Sign in', href: '/login', variant: 'ghost' },
          { label: 'Create account', href: '/register' },
        ]}
      />

      <main>

      <Hero
        align="left"
        title="Live collaboration with a physical tenant boundary."
        description="Guardian multi-tenant authority, advanced RBAC, user-bound API keys, ReactiveDB realtime state, Torrent workflows, and one actor-owned SQLite database per customer workspace—all composed through Zero's public APIs."
        actions={[
          {
            label: 'Start the proof',
            href: '/register',
            icon: <ArrowRight className="size-4" aria-hidden="true" />,
          },
          { label: 'Open an existing workspace', href: '/login', variant: 'outline' },
        ]}
        eyebrow={(
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5 text-public-accent" aria-hidden="true" />
            End-to-end integration proof
          </span>
        )}
        background={{ preset: 'aurora', overlay: true }}
      />

      <FeaturesSection
        id="architecture"
        eyebrow="Guardian + ReactiveDB Fabric + Torrent"
        title="Every boundary is explicit and independently enforced."
        description="The example stays declarative at the application layer while Zero resolves live authority, database placement, identity projection, and realtime delivery."
        features={guarantees}
        visual={<StoragePlanePreview />}
      />

      <section id="acceptance" className="zero-public bg-public-background px-6 pb-24 sm:px-8 lg:px-10">
        <Card className="mx-auto max-w-5xl border-public-border bg-public-glass text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl">
          <CardHeader className="gap-3 text-center">
            <Badge variant="outline" className="mx-auto border-public-border bg-public-surface text-public-muted-foreground">
              Runnable acceptance lab
            </Badge>
            <CardTitle asChild>
              <h2 className="text-2xl sm:text-3xl">Test the real system, not a mocked showcase.</h2>
            </CardTitle>
            <CardDescription className="mx-auto max-w-2xl text-base leading-7 text-public-muted-foreground">
              Bootstrap the Administration Organization, create two customer workspaces,
              exercise invitations and join requests, change roles, manage finite API keys,
              approve a durable workflow, and watch isolated task data update live across browsers.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-center gap-3 pb-7">
            <Button asChild className="bg-public-accent text-public-accent-foreground hover:bg-public-accent/90 focus-visible:ring-public-ring">
              <a href="/register">Create account</a>
            </Button>
            <Button asChild variant="outline" className="border-public-border bg-public-surface text-public-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring">
              <a href="/request-access">Sign in to request access</a>
            </Button>
          </CardContent>
        </Card>
      </section>
      </main>
    </div>
  );
}

function StoragePlanePreview() {
  const planes = [
    ['System', 'Guardian authority plus Torrent definitions, runs, and interactions'],
    ['Application', 'A clean pinned database for app-global data'],
    ['Tenant', 'Tasks, shallow anchors, receipts, and Sync state'],
  ] as const;
  return (
    <div className="grid gap-3 rounded-lg border border-public-border bg-public-surface p-4 shadow-[var(--public-shadow-floating)] sm:p-6">
      {planes.map(([title, description], index) => (
        <div key={title} className="rounded-md border border-public-border bg-public-glass p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-public-accent text-sm font-semibold text-public-accent-foreground">
              {index + 1}
            </span>
            <div>
              <p className="font-semibold text-public-foreground">{title} plane</p>
              <p className="mt-1 text-sm leading-6 text-public-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
