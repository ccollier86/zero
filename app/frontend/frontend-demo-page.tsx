'use client';

/**
 * frontend-demo-page.tsx
 *
 * Renders the temporary Zero public frontend demo page. This file owns page
 * composition only; component behavior comes from @zero/framework/react.
 */

import {
  FlipWords,
  Hero,
  ResizableNavbar,
  TextGenerateEffect,
  TypewriterEffect,
  ZeroIcon,
} from '@zero/framework/react';

/** Render the disposable public landing demo for Zero frontend components. */
export function FrontendDemoPage() {
  return (
    <main
      id="top"
      data-zero-surface="public"
      className="min-h-screen overflow-hidden bg-public-background text-public-foreground"
    >
      <ResizableNavbar
        brand={{
          label: 'Zero',
          href: '/frontend',
          mark: <ZeroIcon name="layers" className="size-4" />,
        }}
        items={frontendDemoNavItems}
        actions={[
          {
            label: 'Open board',
            href: '/',
            variant: 'outline',
            icon: <ZeroIcon name="clipboard" className="size-4" />,
          },
        ]}
      />

      <Hero
        eyebrow={
          <>
            <ZeroIcon name="star" className="size-4 text-public-accent" />
            Public component lane preview
          </>
        }
        title={
          <>
            <TextGenerateEffect words="Build serious apps with" />
            <span className="block text-public-accent">
              <TypewriterEffect
                words={[
                  { text: 'one', className: 'text-public-accent' },
                  { text: 'Zero', className: 'text-public-accent' },
                  { text: 'framework.', className: 'text-public-accent' },
                ]}
                cursorClassName="bg-public-accent"
              />
            </span>
          </>
        }
        description={
          <>
            Zero brings backend, frontend, sync, auth, storage, workflows, AI,
            vector storage, and{' '}
            <FlipWords
              words={['beautiful UI', 'fast apps', 'agent-ready blocks']}
              wordClassName="font-semibold text-public-foreground"
            />{' '}
            into one platform.
          </>
        }
        background={{ preset: 'wavy' }}
        actions={[
          {
            label: 'Open LaunchBoard',
            href: '/',
            icon: <ZeroIcon name="clipboard" className="size-4" />,
          },
        ]}
      />
    </main>
  );
}

const frontendDemoNavItems = [
  { label: 'Hero', href: '/frontend', active: true },
  { label: 'LaunchBoard', href: '/' },
] as const;
