/**
 * page.tsx
 *
 * Default app page. Replace this with your first route, or add nested folders
 * under app/ for more pages.
 */

import { Button } from '@zero/framework/components/ui/button';
import { ArrowRight, Clipboard, ExternalLink } from '@zero/framework/icons';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-12">
      <section className="space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
          <Clipboard className="size-4 text-primary" />
          Zero app starter
        </div>
        <div className="max-w-3xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
            Build your app from here.
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">
            Edit app/page.tsx, define tables in db/schema.ts, and configure
            platform systems in zero.config.ts. Keep app code here; Zero stays
            in node_modules.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href="/api/health">
              Check API
              <ArrowRight className="size-4" />
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="https://github.com/ccollier86/zero">
              <ExternalLink className="size-4" />
              Read docs
            </a>
          </Button>
        </div>
      </section>
    </main>
  );
}
