'use client';

import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { motion } from 'motion/react';

import { getStrictContext } from '#zero/lib/get-strict-context';

type ProgressContextType = {
  value: number;
  max?: number;
};

const [ProgressProvider, useProgress] =
  getStrictContext<ProgressContextType>('ProgressContext');

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root>;

function Progress(props: ProgressProps) {
  return (
    <ProgressProvider value={{ value: props.value ?? 0, max: props.max }}>
      <ProgressPrimitive.Root data-slot="progress" {...props} />
    </ProgressProvider>
  );
}

const MotionProgressIndicator = motion.create(ProgressPrimitive.Indicator);

type ProgressIndicatorProps = React.ComponentProps<
  typeof MotionProgressIndicator
>;

function ProgressIndicator({
  transition = { type: 'spring', stiffness: 100, damping: 30 },
  ...props
}: ProgressIndicatorProps) {
  const { value, max } = useProgress();

  return (
    <MotionProgressIndicator
      data-slot="progress-indicator"
      animate={{ x: `${progressPercentage(value, max) - 100}%` }}
      transition={transition}
      {...props}
    />
  );
}

/** Match the installed Radix range admission; indicator and ARIA use one scale. */
function progressPercentage(value: number, max: number | undefined): number {
  const maximum = typeof max === 'number' && !Number.isNaN(max) && max > 0 ? max : 100;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > maximum) return 0;
  return value === maximum ? 100 : value / maximum * 100;
}

export {
  Progress,
  ProgressIndicator,
  useProgress,
  type ProgressProps,
  type ProgressIndicatorProps,
  type ProgressContextType,
};
