'use client';

import * as React from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Card, CardContent } from '#zero/components/ui/card';
import { GradientText } from '#zero/components/animate-ui/primitives/texts/gradient';
import {
  authShellAnimate,
  authShellInitial,
  authShellTransition,
} from './auth-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthLayoutProps {
  appName?: string;
  logo?: React.ReactNode;
  image?: React.ReactNode;
  gradient?: string;
  background?: 'plain' | 'grid' | 'dot-grid' | 'radial-grid';
  children: React.ReactNode;
  className?: string;
}

// ─── AuthLayout ──────────────────────────────────────────────────────────────

function AuthLayout({
  appName,
  logo,
  image,
  gradient,
  background = 'dot-grid',
  children,
  className,
}: AuthLayoutProps) {
  const displayName = appName ?? 'Zero';
  const reduceMotion = useReducedMotion();

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('relative min-h-screen overflow-hidden bg-background text-foreground', className)}>
        <AuthBackground variant={background} />

        <motion.div
          data-zero-auth-shell
          className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6"
          initial={reduceMotion ? false : authShellInitial}
          animate={reduceMotion ? undefined : authShellAnimate}
          transition={reduceMotion ? { duration: 0 } : authShellTransition}
        >
          <div className="mb-6 flex justify-center">
            {image ?? <AuthBrand appName={displayName} gradient={gradient} logo={logo} />}
          </div>

          <Card className="w-full border-border/80 bg-card/90 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/35">
            <CardContent className="px-6 py-6 sm:px-7 sm:py-7">
              {children}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

function AuthBackground({ variant }: { variant: NonNullable<AuthLayoutProps['background']> }) {
  if (variant === 'plain') {
    return (
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(77,132,255,0.12),transparent_36%)]" />
    );
  }

  const pattern =
    variant === 'grid'
      ? 'bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:42px_42px]'
      : variant === 'radial-grid'
        ? 'bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[size:24px_24px]'
        : 'bg-[radial-gradient(circle,var(--muted-foreground)_1px,transparent_1px)] bg-[size:22px_22px]';

  return (
    <>
      <div className={cn('pointer-events-none absolute inset-0 opacity-[0.28] dark:opacity-[0.18]', pattern)} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(77,132,255,0.18),transparent_34%),linear-gradient(to_bottom,var(--background),transparent_28%,var(--background)_92%)]" />
    </>
  );
}

function AuthBrand({
  appName,
  gradient,
  logo,
  size = 'md',
}: {
  appName: string;
  gradient?: string;
  logo?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {logo ? (
        <div className="flex-shrink-0">{logo}</div>
      ) : (
        <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <span className="text-base font-bold">{appName.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      <GradientText
        text={appName}
        className={cn('font-bold', size === 'lg' ? 'text-2xl' : 'text-xl')}
        {...(gradient ? { gradient } : {})}
      />
    </div>
  );
}

export { AuthLayout, type AuthLayoutProps };
