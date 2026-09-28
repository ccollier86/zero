import * as React from 'react';
import { CircleIcon } from 'lucide-react';

import {
  RadioGroup as RadioGroupPrimitive,
  RadioGroupItem as RadioGroupItemPrimitive,
  RadioGroupIndicator as RadioGroupIndicatorPrimitive,
  type RadioGroupProps as RadioGroupPrimitiveProps,
  type RadioGroupItemProps as RadioGroupItemPrimitiveProps,
} from '#zero/components/animate-ui/primitives/radix/radio-group';
import { cn } from '#zero/lib/utils';

type RadioGroupProps = RadioGroupPrimitiveProps;

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive className={cn('grid gap-3', className)} {...props} />
  );
}

type RadioGroupItemProps = RadioGroupItemPrimitiveProps;

function RadioGroupItem({ className, ...props }: RadioGroupItemProps) {
  return (
    <RadioGroupItemPrimitive
      className={cn(
        'aspect-square size-4 shrink-0 rounded-full border border-input bg-background text-primary shadow-xs transition-[border-color,box-shadow,color] outline-none hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-bg-inset/45 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    >
      <RadioGroupIndicatorPrimitive className="relative flex items-center justify-center">
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupIndicatorPrimitive>
    </RadioGroupItemPrimitive>
  );
}

export {
  RadioGroup,
  RadioGroupItem,
  type RadioGroupProps,
  type RadioGroupItemProps,
};
