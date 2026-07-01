'use client';

/**
 * sonner.tsx
 *
 * Zero's platform toast host. This file owns Sonner's visual integration with
 * the design-token system; callers own toast content and notification policy.
 */

import { useTheme } from 'next-themes';
import { CheckCircle2, Info, Loader2, TriangleAlert, XCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Toaster as Sonner } from 'sonner';

import { cn } from '@/lib/utils';

type ToasterProps = ComponentProps<typeof Sonner>;

/** Theme-aware Sonner host styled to match Zero surfaces and action controls. */
function Toaster({
  className,
  closeButton = true,
  expand = false,
  gap = 10,
  icons,
  position = 'bottom-right',
  richColors = false,
  theme: themeProp,
  toastOptions,
  visibleToasts = 4,
  ...props
}: ToasterProps) {
  const { theme } = useTheme();
  const resolvedTheme = resolveSonnerTheme(themeProp ?? theme);

  return (
    <Sonner
      closeButton={closeButton}
      expand={expand}
      gap={gap}
      icons={{
        success: <CheckCircle2 className="size-4 text-success" />,
        info: <Info className="size-4 text-primary" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <XCircle className="size-4 text-destructive" />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
        ...icons,
      }}
      position={position}
      richColors={richColors}
      theme={resolvedTheme}
      visibleToasts={visibleToasts}
      className={cn('toaster group', className)}
      toastOptions={{
        ...toastOptions,
        className: cn('group/toast', toastOptions?.className),
        classNames: {
          ...toastOptions?.classNames,
          toast: cn(
            'group toast group-[.toaster]:rounded-lg group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-xl group-[.toaster]:shadow-black/10 group-[.toaster]:backdrop-blur supports-[backdrop-filter]:group-[.toaster]:bg-popover/95 dark:group-[.toaster]:shadow-black/30',
            toastOptions?.classNames?.toast,
          ),
          content: cn('group-[.toast]:grid group-[.toast]:gap-1', toastOptions?.classNames?.content),
          title: cn(
            'group-[.toast]:text-sm group-[.toast]:font-medium group-[.toast]:leading-5 group-[.toast]:text-foreground',
            toastOptions?.classNames?.title,
          ),
          description: cn(
            'group-[.toast]:text-xs group-[.toast]:leading-5 group-[.toast]:text-muted-foreground',
            toastOptions?.classNames?.description,
          ),
          icon: cn('group-[.toast]:text-muted-foreground', toastOptions?.classNames?.icon),
          closeButton: cn(
            'group-[.toast]:border-border group-[.toast]:bg-popover group-[.toast]:text-muted-foreground group-[.toast]:shadow-sm group-[.toast]:transition-colors hover:group-[.toast]:bg-accent hover:group-[.toast]:text-accent-foreground',
            toastOptions?.classNames?.closeButton,
          ),
          actionButton: cn(
            'group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:px-3 group-[.toast]:py-1.5 group-[.toast]:text-xs group-[.toast]:font-medium group-[.toast]:text-primary-foreground group-[.toast]:shadow-sm group-[.toast]:transition-colors hover:group-[.toast]:bg-primary/90',
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            'group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:px-3 group-[.toast]:py-1.5 group-[.toast]:text-xs group-[.toast]:font-medium group-[.toast]:text-muted-foreground group-[.toast]:transition-colors hover:group-[.toast]:bg-muted/80 hover:group-[.toast]:text-foreground',
            toastOptions?.classNames?.cancelButton,
          ),
          success: cn(
            'group-[.toaster]:border-l-4 group-[.toaster]:border-l-success',
            toastOptions?.classNames?.success,
          ),
          error: cn(
            'group-[.toaster]:border-l-4 group-[.toaster]:border-l-destructive',
            toastOptions?.classNames?.error,
          ),
          warning: cn(
            'group-[.toaster]:border-l-4 group-[.toaster]:border-l-warning',
            toastOptions?.classNames?.warning,
          ),
          info: cn(
            'group-[.toaster]:border-l-4 group-[.toaster]:border-l-primary',
            toastOptions?.classNames?.info,
          ),
          loading: cn(
            'group-[.toaster]:border-l-4 group-[.toaster]:border-l-muted-foreground/50',
            toastOptions?.classNames?.loading,
          ),
        },
      }}
      {...props}
    />
  );
}

function resolveSonnerTheme(theme: ToasterProps['theme'] | string | undefined): ToasterProps['theme'] {
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
}

export { Toaster, type ToasterProps };
