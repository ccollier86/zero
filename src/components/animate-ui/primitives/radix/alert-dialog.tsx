'use client';

/**
 * Owns animated Radix alert-dialog primitives. Radix retains focus, portal and
 * accessible dialog semantics; Motion animates the same content element.
 */

import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from 'motion/react';

import { useControlledState } from '#zero/hooks/use-controlled-state';
import { getStrictContext } from '#zero/lib/get-strict-context';

type AlertDialogContextType = {
  isOpen: boolean;
  setIsOpen: AlertDialogProps['onOpenChange'];
};

const [AlertDialogProvider, useAlertDialog] =
  getStrictContext<AlertDialogContextType>('AlertDialogContext');

/** Retain closing content only until its animation completes, not indefinitely. */
function useAlertDialogPresence(isOpen: boolean) {
  const [rendered, setRendered] = React.useState(isOpen);
  const currentOpen = React.useRef(isOpen);
  currentOpen.current = isOpen;
  React.useEffect(() => {
    if (isOpen) setRendered(true);
  }, [isOpen]);
  const finishClosing = React.useCallback(() => {
    if (!currentOpen.current) setRendered(false);
  }, []);
  return { present: isOpen || rendered, finishClosing };
}

type AlertDialogProps = React.ComponentProps<typeof AlertDialogPrimitive.Root>;

function AlertDialog(props: AlertDialogProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  });

  return (
    <AlertDialogProvider value={{ isOpen, setIsOpen }}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        {...props}
        onOpenChange={setIsOpen}
      />
    </AlertDialogProvider>
  );
}

type AlertDialogTriggerProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Trigger
>;

function AlertDialogTrigger(props: AlertDialogTriggerProps) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

type AlertDialogPortalProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Portal>,
  'forceMount'
>;

function AlertDialogPortal({ children, ...props }: AlertDialogPortalProps) {
  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      forceMount
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Portal>
  );
}

type AlertDialogOverlayProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Overlay>,
  'forceMount' | 'asChild'
> &
  HTMLMotionProps<'div'>;

function AlertDialogOverlay({
  transition = { duration: 0.2, ease: 'easeInOut' },
  onAnimationComplete,
  initial,
  animate,
  exit,
  ...props
}: AlertDialogOverlayProps) {
  const reduceMotion = useReducedMotion() === true;
  const { isOpen } = useAlertDialog();
  const { present, finishClosing } = useAlertDialogPresence(isOpen);
  const closed = exit ?? { opacity: 0, filter: 'blur(4px)' };
  if (!present) return null;
  return (
    <AlertDialogPrimitive.Overlay
      key="alert-dialog-overlay"
      data-slot="alert-dialog-overlay"
      asChild
      forceMount
    >
      <motion.div
        key="alert-dialog-overlay"
        initial={reduceMotion ? false : initial ?? closed}
        animate={isOpen ? animate ?? { opacity: 1, filter: 'blur(0px)' } : closed}
        exit={reduceMotion ? undefined : closed}
        transition={reduceMotion ? { duration: 0 } : transition}
        onAnimationComplete={(definition) => {
          finishClosing();
          onAnimationComplete?.(definition);
        }}
        {...props}
      />
    </AlertDialogPrimitive.Overlay>
  );
}

type AlertDialogFlipDirection = 'top' | 'bottom' | 'left' | 'right';

type AlertDialogContentProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Content>,
  'forceMount' | 'asChild'
> &
  HTMLMotionProps<'div'> & {
    from?: AlertDialogFlipDirection;
  };

// Keep a single content element. AlertDialog adds internal Slottable/warning
// children, so nesting motion.div through asChild depends on private Slot
// module identity and can fail when supported dependency copies coexist.
const MotionAlertDialogContent = motion.create(AlertDialogPrimitive.Content);

function AlertDialogContent({
  from = 'top',
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onAnimationComplete,
  initial,
  animate,
  exit,
  transition = { type: 'spring', stiffness: 150, damping: 25 },
  ...props
}: AlertDialogContentProps) {
  const reduceMotion = useReducedMotion() === true;
  const { isOpen } = useAlertDialog();
  const { present, finishClosing } = useAlertDialogPresence(isOpen);
  const initialRotation =
    from === 'bottom' || from === 'left' ? '20deg' : '-20deg';
  const isVertical = from === 'top' || from === 'bottom';
  const rotateAxis = isVertical ? 'rotateX' : 'rotateY';
  const closed = exit ?? {
    opacity: 0,
    filter: 'blur(4px)',
    transform: `perspective(500px) ${rotateAxis}(${initialRotation}) scale(0.8)`,
  };

  if (!present) return null;
  return (
    <MotionAlertDialogContent
      forceMount
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={onEscapeKeyDown}
      key="alert-dialog-content"
      data-slot="alert-dialog-content"
      initial={reduceMotion ? false : initial ?? closed}
      animate={isOpen ? animate ?? {
        opacity: 1,
        filter: 'blur(0px)',
        transform: `perspective(500px) ${rotateAxis}(0deg) scale(1)`,
      } : closed}
      exit={reduceMotion ? undefined : closed}
      transition={reduceMotion ? { duration: 0 } : transition}
      onAnimationComplete={(definition) => {
        finishClosing();
        onAnimationComplete?.(definition);
      }}
      {...props}
    />
  );
}

type AlertDialogCancelProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Cancel
>;

function AlertDialogCancel(props: AlertDialogCancelProps) {
  return (
    <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" {...props} />
  );
}

type AlertDialogActionProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Action
>;

function AlertDialogAction(props: AlertDialogActionProps) {
  return (
    <AlertDialogPrimitive.Action data-slot="alert-dialog-action" {...props} />
  );
}

type AlertDialogHeaderProps = React.ComponentProps<'div'>;

function AlertDialogHeader(props: AlertDialogHeaderProps) {
  return <div data-slot="alert-dialog-header" {...props} />;
}

type AlertDialogFooterProps = React.ComponentProps<'div'>;

function AlertDialogFooter(props: AlertDialogFooterProps) {
  return <div data-slot="alert-dialog-footer" {...props} />;
}

type AlertDialogTitleProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Title
>;

function AlertDialogTitle(props: AlertDialogTitleProps) {
  return (
    <AlertDialogPrimitive.Title data-slot="alert-dialog-title" {...props} />
  );
}

type AlertDialogDescriptionProps = React.ComponentProps<
  typeof AlertDialogPrimitive.Description
>;

function AlertDialogDescription(props: AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  useAlertDialog,
  type AlertDialogProps,
  type AlertDialogTriggerProps,
  type AlertDialogPortalProps,
  type AlertDialogCancelProps,
  type AlertDialogActionProps,
  type AlertDialogOverlayProps,
  type AlertDialogContentProps,
  type AlertDialogHeaderProps,
  type AlertDialogFooterProps,
  type AlertDialogTitleProps,
  type AlertDialogDescriptionProps,
  type AlertDialogContextType,
  type AlertDialogFlipDirection,
};
