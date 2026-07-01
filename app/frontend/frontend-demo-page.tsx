'use client';

/**
 * frontend-demo-page.tsx
 *
 * Renders the temporary Zero public frontend demo page. This file owns page
 * composition only; component behavior comes from @zero/framework/react.
 */

import {
  CodeBlock,
  FeaturesSection,
  FlipWords,
  Hero,
  ResizableNavbar,
  TypewriterEffect,
  ZeroIcon,
} from '@zero/framework/react';
import { motion, useReducedMotion } from 'motion/react';

/** Render the disposable public landing demo for Zero frontend components. */
export function FrontendDemoPage() {
  const reduceMotion = useReducedMotion();

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
                <TypewriterEffect
                  words={[
                    { text: 'one', className: 'text-public-accent' },
                    { text: 'Zero', className: 'text-public-accent' },
                    { text: 'framework.', className: 'text-public-accent' },
                  ]}
                  cursorClassName="bg-public-accent"
                  startDelay={0}
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
      </motion.div>

      <FeaturesSection
        id="features"
        eyebrow="Deploy faster"
        title="A better workflow for serious full-stack apps"
        description="Zero gives app code a single framework surface for data, sync, auth, UI, AI, storage, workflows, and deployment."
        features={frontendDemoFeatures}
        visual={
          <CodeBlock
            files={frontendDemoCodeFiles}
            defaultFileId="server"
            showLineNumbers
            className="lg:translate-x-2"
          />
        }
        className="pb-32 pt-0"
      />
    </main>
  );
}

const frontendDemoNavItems = [
  { label: 'Hero', href: '/frontend', active: true },
  { label: 'Features', href: '#features' },
  { label: 'LaunchBoard', href: '/' },
] as const;

const frontendDemoFeatures = [
  {
    id: 'ship',
    iconName: 'upload',
    title: 'One server, one deploy.',
    description: 'File routes, Elysia plugins, SSR, sync, auth, storage, AI, and workflows run in one Bun app.',
  },
  {
    id: 'reactive',
    iconName: 'radio',
    title: 'Reactive data without socket work.',
    description: 'Define a table once, subscribe from React, and let Zero handle snapshots, live changes, and policy checks.',
  },
  {
    id: 'polished',
    iconName: 'star',
    title: 'Production UI out of the box.',
    description: 'Use tokenized public sections, app shells, data organisms, animated icons, modals, toasts, and hooks before rebuilding basics.',
  },
] as const;

const frontendDemoCodeFiles = [
  {
    id: 'server',
    filename: 'app/server.ts',
    language: 'ts',
    code: `import { createApp, defineZeroConfig } from '@zero/framework/server';
import { defineTable, field } from '@zero/framework/schema';

const tasks = defineTable(
  'tasks',
  {
    title: field.text({ label: 'Title', required: true }),
    status: field.text({ label: 'Status', required: true }),
    priority: field.select(
      [
        { label: 'Low', value: 'low' },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
      ],
      { label: 'Priority', defaultValue: 'normal' },
    ),
  },
  { pk: 'task_id', sync: 'full' },
);

const config = defineZeroConfig({
  db: { mode: 'hot', path: './data/app.db' },
  tables: { tasks },
  auth: true,
  stateSync: true,
  ai: true,
  vector: true,
});

const app = await createApp(config);
app.listen(3000);`,
  },
  {
    id: 'page',
    filename: 'app/page.tsx',
    language: 'tsx',
    code: `import {
  AppShell,
  Button,
  useCollection,
} from '@zero/framework/react';

export default function TasksPage() {
  const { data, insert, update } = useCollection('tasks');

  return (
    <AppShell breadcrumbs={[{ label: 'Tasks' }]}>
      <Button onClick={() => insert({ title: 'New task', status: 'queued' })}>
        Add task
      </Button>
      <div className="mt-4 grid gap-2">
        {data.map((task) => (
          <Button
            key={task.task_id}
            variant="ghost"
            className="justify-start"
            onClick={() => update(task.task_id, { status: 'done' })}
          >
            {task.title}
          </Button>
        ))}
      </div>
    </AppShell>
  );
}`,
  },
] as const;
