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
  TypewriterEffect,
  ZeroIcon,
} from '@zero/framework/react';
import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';

/** Render the disposable public landing demo for Zero frontend components. */
export function FrontendDemoPage() {
  const reduceMotion = useReducedMotion();
  const [heroEntered, setHeroEntered] = React.useState(() => reduceMotion === true);

  React.useEffect(() => {
    if (reduceMotion) setHeroEntered(true);
  }, [reduceMotion]);

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

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 20, filter: 'blur(14px)' }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => setHeroEntered(true)}
      >
        <Hero
          eyebrow={
            <>
              <ZeroIcon name="star" className="size-4 text-public-accent" />
              Public component lane preview
            </>
          }
          title={
            <>
              <span>Build serious apps with</span>
              <span className="block text-public-accent">
                {heroEntered ? (
                  <TypewriterEffect
                    words={[
                      { text: 'one', className: 'text-public-accent' },
                      { text: 'Zero', className: 'text-public-accent' },
                      { text: 'framework.', className: 'text-public-accent' },
                    ]}
                    cursorClassName="bg-public-accent"
                  />
                ) : (
                  <span className="inline-block min-h-[1em]" aria-hidden="true" />
                )}
              </span>
            </>
          }
          description={
            <>
              Zero brings backend, frontend, sync, auth, storage, workflows, AI,
              vector storage, and{' '}
              {heroEntered ? (
                <FlipWords
                  words={['beautiful UI', 'fast apps', 'agent-ready blocks']}
                  wordClassName="font-semibold text-public-foreground"
                />
              ) : (
                <span className="font-semibold text-public-foreground">beautiful UI</span>
              )}{' '}
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
      </motion.div>
    </main>
  );
}

const frontendDemoNavItems = [
  { label: 'Hero', href: '/frontend', active: true },
  { label: 'LaunchBoard', href: '/' },
] as const;
