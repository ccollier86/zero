import { ArrowRight, Check, Layers, Lock, Wifi } from '@zero/framework/icons';
import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

export const meta = {
  title: 'Guardian + Fabric Proof',
  description: 'Guardian authority, physically isolated tenant data, and realtime task collaboration.',
};

const guarantees = [
  {
    icon: Lock,
    title: 'Guardian is the authority',
    description: 'Sessions, memberships, roles, permissions, and API keys are checked on the server for every protected operation.',
  },
  {
    icon: Layers,
    title: 'One database per workspace',
    description: 'Task rows have no tenant discriminator. Fabric selects an actor-owned SQLite database from trusted tenant authority.',
  },
  {
    icon: Wifi,
    title: 'Realtime by default',
    description: 'The task board subscribes through ReactiveDB Sync while writes travel through policy-protected Resource actions.',
  },
] as const;

/** Public product and architecture overview. */
export default function LandingPage() {
  return (
    <main
      className="zero-public-page bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--public-accent)_18%,transparent),transparent_34rem),radial-gradient(circle_at_80%_15%,color-mix(in_oklch,var(--public-muted-foreground)_14%,transparent),transparent_25rem),var(--public-background)]"
      data-zero-page="public"
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6" aria-label="Primary navigation">
        <a className="flex items-center gap-2 font-semibold tracking-tight" href="/">
          <span className="grid size-9 place-items-center rounded-lg bg-public-accent text-public-accent-foreground shadow-[var(--public-shadow-floating)]">
            <Layers className="size-5" aria-hidden="true" />
          </span>
          Guardian + Fabric
        </a>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="text-public-foreground hover:bg-public-accent-soft hover:text-public-foreground">
            <a href="/login">Sign in</a>
          </Button>
          <Button asChild className="bg-public-accent text-public-accent-foreground hover:bg-public-accent/90 focus-visible:ring-public-ring">
            <a href="/register">Create account</a>
          </Button>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pt-24">
        <div className="space-y-7">
          <Badge variant="outline" className="gap-1.5 border-public-border bg-public-glass px-3 py-1 text-public-muted-foreground shadow-[var(--public-shadow-floating)] backdrop-blur">
            <Check className="size-3.5 text-public-accent" aria-hidden="true" />
            End-to-end integration proof
          </Badge>
          <div className="space-y-5">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Live collaboration with a physical tenant boundary.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-public-muted-foreground">
              This example composes Guardian multi-tenant authorization with ReactiveDB Fabric.
              The browser sees one realtime task board; the server binds every read and write to
              the active workspace's dedicated database.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-public-accent text-public-accent-foreground hover:bg-public-accent/90 focus-visible:ring-public-ring">
              <a href="/register">
                Start the proof
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-public-border bg-public-glass text-public-foreground shadow-[var(--public-shadow-floating)] backdrop-blur hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring">
              <a href="/login">Open an existing workspace</a>
            </Button>
          </div>
          <p className="text-sm text-public-muted-foreground">
            Feature-branch proof: follow the README acceptance flow before adapting it for deployment.
          </p>
        </div>

        <div className="grid gap-4">
          {guarantees.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="border-public-border bg-public-glass text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur">
              <CardHeader className="flex-row items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-public-accent-soft text-public-accent">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="space-y-1.5">
                  <CardTitle>{title}</CardTitle>
                  <CardDescription className="leading-6 text-public-muted-foreground">{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
