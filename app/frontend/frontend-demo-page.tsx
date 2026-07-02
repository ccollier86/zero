'use client';

/**
 * frontend-demo-page.tsx
 *
 * Renders the temporary Zero public frontend demo page. This file owns page
 * composition only; component behavior comes from @zero/framework/react.
 */

import {
  AnimateIcon,
  CodeBlock,
  CtaSection,
  Faq,
  FeaturesSection,
  FlipWords,
  FooterSection,
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
            label: 'Demo app',
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
              AI-assisted app development
            </>
          }
          title={
            <>
              <span>Build real apps with AI</span>
              <span className="block text-public-accent">
                <TypewriterEffect
                  words={[
                    { text: 'without', className: 'text-public-accent' },
                    { text: 'the', className: 'text-public-accent' },
                    { text: 'mess.', className: 'text-public-accent' },
                  ]}
                  cursorClassName="bg-public-accent"
                  startDelay={180}
                />
              </span>
            </>
          }
          description={
            <>
              Zero gives AI and developers the ready starting point modern apps need,
              so you can go from idea to working product with the core systems
              already in place. Build with{' '}
              <FlipWords
                words={['less mess', 'fewer services', 'better defaults']}
                wordClassName="font-semibold text-public-foreground"
              />{' '}
              from the first pass.
            </>
          }
          background={{ preset: 'wavy' }}
          actions={[
            {
              label: 'See the demo app',
              href: '/',
              icon: <ZeroIcon name="clipboard" className="size-4" />,
            },
          ]}
        />
      </motion.div>

      <FeaturesSection
        id="features"
        eyebrow="Fewer services. Faster apps."
        title={
          <>
            Everything your app needs
            <span className="block text-public-accent">without the service sprawl</span>
          </>
        }
        description="The everyday systems are already there: users, data, live updates, files, messages, AI, polished screens, and more."
        features={frontendDemoFeatures}
        visual={<FrontendDemoCodeVisual />}
        framed={false}
        className="pb-32 pt-0"
      />

      <FrontendDemoAgentSection />

      <FrontendDemoFaqSection />

      <FrontendDemoCtaSection />

      <FrontendDemoFooterSection />
    </main>
  );
}

function FrontendDemoAgentSection() {
  return (
    <section
      id="agent-flow"
      data-zero-surface="public"
      className="zero-public bg-public-background px-6 pb-32 pt-0 text-public-foreground sm:px-8 lg:px-10"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center">
        <FrontendDemoSectionHeader
          eyebrow="Agent-ready development loop"
          title={
            <>
              AI-built apps should not
              <span className="block text-public-accent">look or feel AI-built</span>
            </>
          }
          description="AI works better when the app structure and interface patterns are already clear. Zero lets it build product features instead of guessing through architecture, design, and glue code."
          align="center"
        />

        <div className="mt-20 grid w-full gap-x-8 gap-y-20 md:grid-cols-2 lg:grid-cols-3">
          {frontendDemoAgentCards.map((card) => (
            <AnimateIcon
              key={card.id}
              animateOnHover
              completeOnStop
              asChild
              className="group relative rounded-lg border border-public-border bg-public-glass px-6 pb-8 pt-16 text-center shadow-[var(--public-shadow-floating)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:bg-public-surface"
            >
              <article>
                <span className="absolute left-1/2 top-0 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border border-public-border bg-public-surface text-public-accent shadow-[var(--public-shadow-floating)] transition duration-300 group-hover:-translate-y-[55%] group-hover:bg-public-accent-soft">
                  <ZeroIcon name={card.iconName} className="size-8" />
                </span>
                <h3 className="text-xl font-semibold leading-7 text-public-foreground">
                  {card.title}
                </h3>
                <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-public-muted-foreground">
                  {card.description}
                </p>
              </article>
            </AnimateIcon>
          ))}
        </div>
      </div>
    </section>
  );
}

function FrontendDemoFaqSection() {
  return (
    <section
      id="faq"
      data-zero-surface="public"
      className="zero-public bg-public-background px-6 pb-32 pt-0 text-public-foreground sm:px-8 lg:px-10"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div className="lg:sticky lg:top-28">
          <FrontendDemoSectionHeader
            eyebrow="Framework questions"
            title={
              <>
                What Zero solves
                <span className="block text-public-accent">before the app gets messy</span>
              </>
            }
            description="AI can write code quickly, but projects slow down when the same basics have to be invented again and again. Zero gives those common pieces a home, and leaves room for everything else."
          />

          <div className="mt-10 rounded-lg border border-public-border bg-public-glass p-5 shadow-[var(--public-shadow-floating)] backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-public-border bg-public-surface text-public-accent shadow-sm">
                <ZeroIcon name="message-circle" className="size-5" />
              </span>
              <div>
                <div className="text-sm font-semibold text-public-foreground">
                  Need the technical details?
                </div>
                <p className="mt-1 text-sm leading-6 text-public-muted-foreground">
                  The landing page should stay simple. The docs can break down
                  the database, cache, AI, vector search, realtime, storage,
                  deployment, and more.
                </p>
              </div>
            </div>
          </div>
        </div>

        <Faq
          title={null}
          items={frontendDemoFaqItems}
          defaultOpenIds={['scope']}
          allowMultiple
          className="max-w-none px-0 py-0"
          listClassName="mx-0 max-w-none"
        />
      </div>
    </section>
  );
}

function FrontendDemoCtaSection() {
  return (
    <CtaSection
      id="cta"
      eyebrow="Build with Zero"
      title={
        <>
          Start ahead
          <span className="block text-public-accent">then build the product</span>
        </>
      }
      description="Stop asking AI to rebuild the same setup for every project. Give it Zero, then point it at the product you actually want."
      actions={[
        {
          label: 'See the demo app',
          href: '/',
          icon: <ZeroIcon name="clipboard" className="size-4" />,
        },
        {
          label: 'Explore the pieces',
          href: '#features',
          variant: 'outline',
          icon: <ZeroIcon name="arrow-up" className="size-4" />,
        },
      ]}
      className="pb-32 pt-0"
    />
  );
}

function FrontendDemoFooterSection() {
  return (
    <FooterSection
      id="footer"
      brand={{
        label: 'Zero',
        href: '/frontend',
        mark: <ZeroIcon name="layers" className="size-5" />,
        description: 'Build AI-assisted apps with the product pieces already ready: auth, data, UI, AI, workflows, and more.',
      }}
      linksTitle="Explore"
      links={frontendDemoFooterLinks}
      actionTitle="Start from working pieces"
      actionDescription="Open the demo app, then inspect how the framework pieces snap together."
      actions={[
        {
          label: 'See the demo app',
          href: '/',
          variant: 'outline',
          icon: <ZeroIcon name="clipboard" className="size-4" />,
        },
        {
          label: 'Explore the pieces',
          href: '#features',
          variant: 'ghost',
          icon: <ZeroIcon name="arrow-up" className="size-4" />,
        },
      ]}
      socialTitle="Resources"
      socialLinks={frontendDemoFooterSocialLinks}
      copyright="© 2026 Zero Framework. All rights reserved."
    />
  );
}

interface FrontendDemoSectionHeaderProps {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
}

function FrontendDemoSectionHeader({
  eyebrow,
  title,
  description,
  align = 'left',
}: FrontendDemoSectionHeaderProps) {
  const centered = align === 'center';

  return (
    <div className={centered ? 'max-w-3xl text-center' : 'max-w-xl'}>
      <div className="mb-5 text-sm font-semibold text-public-accent">
        {eyebrow}
      </div>
      <h2 className="text-balance text-4xl font-semibold leading-tight text-public-foreground sm:text-5xl">
        {title}
      </h2>
      {description ? (
        <p
          className={
            centered
              ? 'mx-auto mt-6 max-w-2xl text-pretty text-lg leading-8 text-public-muted-foreground'
              : 'mt-6 max-w-xl text-pretty text-lg leading-8 text-public-muted-foreground'
          }
        >
          {description}
        </p>
      ) : null}
    </div>
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
  { label: 'AI Apps', href: '#agent-flow' },
  { label: 'FAQ', href: '#faq' },
  { label: 'CTA', href: '#cta' },
  { label: 'Demo App', href: '/' },
] as const;

const frontendDemoFooterLinks = [
  { label: 'Overview', href: '#top' },
  { label: 'Features', href: '#features' },
  { label: 'AI Apps', href: '#agent-flow' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Demo App', href: '/' },
] as const;

const frontendDemoFooterSocialLinks = [
  {
    label: 'Docs',
    href: '#features',
    icon: <ZeroIcon name="link" className="size-5" />,
  },
  {
    label: 'Community',
    href: '#faq',
    icon: <ZeroIcon name="message-circle" className="size-5" />,
  },
  {
    label: 'Examples',
    href: '/',
    icon: <ZeroIcon name="users" className="size-5" />,
  },
  {
    label: 'External',
    href: '#top',
    icon: <ZeroIcon name="external-link" className="size-5" />,
  },
] as const;

const frontendDemoAgentCards = [
  {
    id: 'foundation',
    title: 'Start from real app defaults',
    description: 'The common app systems are ready before the first feature is built: accounts, data, files, live updates, AI, and more.',
    iconName: 'layers',
  },
  {
    id: 'speed',
    title: 'Fewer services to fight',
    description: 'Zero keeps the common app systems together, so there is less setup, less glue code, and fewer places for an app to break.',
    iconName: 'radio',
  },
  {
    id: 'screens',
    title: 'Professional screens faster',
    description: 'AI can assemble polished app shells, forms, tables, dialogs, landing pages, menus, and custom views from pieces that already fit together.',
    iconName: 'star',
  },
  {
    id: 'live',
    title: 'Live apps without extra setup',
    description: 'Data can update across the app without every project rebuilding its own realtime layer from scratch.',
    iconName: 'upload',
  },
  {
    id: 'ai',
    title: 'AI features built into the stack',
    description: 'Apps are ready for OpenAI, Claude, Bedrock, Deepgram, Voyage, and more out of the box. Add your keys and build.',
    iconName: 'message-square',
  },
  {
    id: 'ownership',
    title: 'Defaults without lock-in',
    description: 'Use the ready-made pieces to move quickly, then theme, replace, or copy source when the product needs something custom.',
    iconName: 'settings',
  },
] as const;

const frontendDemoFaqItems = [
  {
    id: 'scope',
    iconName: 'layers',
    question: 'What is Zero?',
    answer: 'Zero is a full-stack framework for building real apps with AI faster. It gives each project a ready starting point instead of starting from a blank stack.',
  },
  {
    id: 'agents',
    iconName: 'message-square',
    question: 'Why does this help AI build better apps?',
    answer: 'AI is better when it can compose known building blocks. Zero provides the common systems and interface patterns it usually has to invent from scratch.',
  },
  {
    id: 'custom',
    iconName: 'settings',
    question: 'Does Zero replace outside services?',
    answer: 'It can replace many services small and medium apps usually wire together, while still letting the app connect to outside providers when that makes sense.',
  },
  {
    id: 'deploy',
    iconName: 'upload',
    question: 'Why can apps feel faster on Zero?',
    answer: 'Most stacks add another hop for every important feature. Zero keeps more of the app together, so there is less standing between the user and the result.',
  },
  {
    id: 'frontend',
    iconName: 'star',
    question: 'Can AI-built apps actually look good?',
    answer: 'That is part of the point. Zero includes modern animated components, app shells, forms, tables, modals, menus, landing sections, themes, icons, and more that already fit together.',
  },
  {
    id: 'integrations',
    iconName: 'settings',
    question: 'Can developers still customize everything?',
    answer: 'Yes. Zero gives strong defaults so projects start fast, but developers can theme the UI, copy components, add custom app code, and swap providers when a product needs a different path.',
  },
] as const;

const frontendDemoFeatures = [
  {
    id: 'ship',
    iconName: 'upload',
    title: 'Fewer moving parts.',
    description: 'Build with the essentials already in place instead of wiring a pile of services before the product work starts.',
  },
  {
    id: 'reactive',
    iconName: 'radio',
    title: 'Faster because less gets in the way.',
    description: 'Zero reduces the hops and hand-built glue that slow apps down, making it easier to ship something fast from the start.',
  },
  {
    id: 'polished',
    iconName: 'star',
    title: 'Beautiful screens are built in.',
    description: 'AI can assemble professional views from polished animated components instead of guessing through layout, spacing, and interaction design.',
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
