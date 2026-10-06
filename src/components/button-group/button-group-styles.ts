/**
 * button-group-styles.ts
 *
 * Defines token-aware layout styles shared by action and selection groups. It
 * owns joining geometry only; individual controls retain their native semantics.
 */

import { cva, type VariantProps } from 'class-variance-authority';

/** Shared group layout; spacing separates controls or joins their outer edges. */
export const buttonGroupVariants = cva(
  'group/button-group isolate inline-flex w-fit max-w-full min-w-0 items-stretch rounded-md border-0 p-0 align-middle [&>*]:min-w-0 [&>*:focus-visible]:relative [&>*:focus-visible]:z-10 [&>*:focus-within]:relative [&>*:focus-within]:z-10 [&>[data-slot=select-trigger]]:w-auto',
  {
    variants: {
      orientation: {
        horizontal: 'flex-row',
        vertical: 'flex-col',
      },
      spacing: {
        joined: 'gap-0',
        separated: 'gap-2',
      },
    },
    compoundVariants: [
      {
        orientation: 'horizontal', spacing: 'joined',
        className: '[&>:not(:first-child)]:rounded-s-none [&>:not(:last-child)]:rounded-e-none [&>:not(:first-child)]:-ms-px [&>:not(:first-child)>[data-slot=input]]:rounded-s-none [&>:not(:last-child)>[data-slot=input]]:rounded-e-none [&>:not(:first-child)[data-orientation=horizontal]>:first-child]:rounded-s-none [&>:not(:last-child)[data-orientation=horizontal]>:last-child]:rounded-e-none',
      },
      {
        orientation: 'vertical', spacing: 'joined',
        className: '[&>:not(:first-child)]:rounded-t-none [&>:not(:last-child)]:rounded-b-none [&>:not(:first-child)]:-mt-px [&>:not(:first-child)>[data-slot=input]]:rounded-t-none [&>:not(:last-child)>[data-slot=input]]:rounded-b-none [&>:not(:first-child)[data-orientation=vertical]>:first-child]:rounded-t-none [&>:not(:last-child)[data-orientation=vertical]>:last-child]:rounded-b-none',
      },
    ],
    defaultVariants: { orientation: 'horizontal', spacing: 'joined' },
  },
);

/** Presentation options shared by ordinary action groups and toggle groups. */
export type ButtonGroupLayoutProps = VariantProps<typeof buttonGroupVariants>;

/** Heights and addon padding matching Zero's existing Button size scale. */
export const buttonGroupTextVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-muted/50 text-sm font-medium whitespace-nowrap text-muted-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      size: {
        xs: 'min-h-6 gap-1 px-2 text-xs [&_svg]:size-3',
        sm: 'min-h-8 gap-1.5 px-2.5',
        default: 'min-h-9 px-3',
        lg: 'min-h-10 px-4',
      },
    },
    defaultVariants: { size: 'default' },
  },
);
