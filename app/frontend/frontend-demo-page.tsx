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
import * as React from 'react';
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
        initial={reduceMotion ? false : { opacity: 0, y: 42, scale: 0.985, filter: 'blur(18px)' }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{
          duration: 1.18,
          ease: [0.16, 1, 0.3, 1],
          opacity: { duration: 0.92, ease: 'easeOut' },
          filter: { duration: 1.05, ease: 'easeOut' },
        }}
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
                  startDelay={180}
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
        title={
          <>
            A better workflow for{' '}
            <span className="block text-public-accent">serious full-stack apps</span>
          </>
        }
        description="Zero gives app code a single framework surface for data, sync, auth, UI, AI, storage, workflows, and deployment."
        features={frontendDemoFeatures}
        visual={<FrontendDemoCodeVisual />}
        framed={false}
        className="pb-32 pt-0"
      />
    </main>
  );
}

function FrontendDemoCodeVisual() {
  const reduceMotion = useReducedMotion();
  const [activeFileId, setActiveFileId] = React.useState('page');

  React.useEffect(() => {
    if (reduceMotion) return undefined;

    const timer = window.setTimeout(() => {
      setActiveFileId((current) => current === 'page' ? 'server' : 'page');
    }, 5400);

    return () => window.clearTimeout(timer);
  }, [activeFileId, reduceMotion]);

  return (
    <>
      <style>
        {`@keyframes zero-demo-code-fade {
          0% { opacity: 0.42; filter: blur(7px); transform: translateY(4px); }
          100% { opacity: 1; filter: blur(0); transform: translateY(0); }
        }`}
      </style>
      <CodeBlock
        files={frontendDemoCodeFiles}
        activeFileId={activeFileId}
        defaultFileId="page"
        showLineNumbers
        minLines={22}
        className="lg:translate-x-2"
        contentKey={activeFileId}
        contentClassName={
          reduceMotion
            ? undefined
            : 'animate-[zero-demo-code-fade_520ms_cubic-bezier(0.22,1,0.36,1)]'
        }
        onFileChange={(file) => setActiveFileId(file.id)}
      />
    </>
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
    description: 'Subscribe from React, mutate through Zero, and let snapshots, live changes, and policy checks stay aligned.',
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
    id: 'page',
    filename: 'app/page.tsx',
    language: 'tsx',
    code: `import {
  AppShell,
  Button,
  useCollection,
} from '@zero/framework/react';

type TaskRow = {
  task_id: string;
  title: string;
  status: 'queued' | 'working' | 'done';
  created_at: number;
};

export default function TasksPage() {
  const tasks = useCollection<TaskRow>('tasks');

  const addTask = () => tasks.insert({
    task_id: crypto.randomUUID(),
    title: 'Review intake flow',
    status: 'queued',
    created_at: Date.now(),
  });

  return (
    <AppShell breadcrumbs={[{ label: 'Tasks' }]}>
      <Button onClick={addTask}>
        Add task
      </Button>

      <div className="mt-4 grid gap-2">
        {tasks.data.map((task) => (
          <Button
            key={task.task_id}
            variant="ghost"
            className="justify-start"
            onClick={() => tasks.update(task.task_id, { status: 'done' })}
          >
            {task.title} · {task.status}
          </Button>
        ))}
      </div>
    </AppShell>
  );
}`,
  },
  {
    id: 'server',
    filename: 'server/routes/tasks.ts',
    language: 'ts',
    code: `import { t } from 'elysia';
import {
  defineEndpoint,
  defineRouter,
} from '@zero/framework/server';

export default defineRouter({
  name: 'tasks.actions',
  prefix: '/api/tasks',
  auth: 'user',
  endpoints: [
    defineEndpoint({
      method: 'POST',
      path: '/:taskId/brief',
      params: t.Object({
        taskId: t.String(),
      }),
      body: t.Object({
        notes: t.String({ minLength: 1 }),
      }),
      handler: async ({ params, body, user, zero }) => {
        const task = zero.db.get('tasks', params.taskId);
        if (!task) return { ok: false, reason: 'missing-task' };

        const summary = zero.ai
          ? await zero.ai.generateText({
              model: 'fast',
              prompt: \`Summarize this task: \${body.notes}\`,
            }).then((result) => result.text)
          : body.notes;

        zero.db.update('tasks', params.taskId, {
          status: 'working',
          summary,
          updated_by: user.userId,
        });

        await zero.kv?.namespace('task-activity').set(params.taskId, {
          summarizedAt: Date.now(),
          userId: user.userId,
        });

        return { ok: true, summary };
      },
    }),
  ],
});`,
  },
] as const;
