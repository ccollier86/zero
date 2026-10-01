import * as React from 'react';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

/** Full-surface fallback used outside the protected administration scope. */
export function PlatformWorkspaceUnavailable(props: {
  className?: string;
  title: string;
  description: string;
  plural: string;
}) {
  const headingId = React.useId();
  const descriptionId = `${headingId}-description`;
  return (
    <section
      className={cn(
        'flex h-full min-h-[20rem] flex-col overflow-hidden rounded-lg border border-border bg-background',
        props.className,
      )}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className="border-b border-border/70 px-3 py-3">
        <h2 id={headingId} className="text-base font-semibold">{props.title}</h2>
        <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
          {props.description}
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          Switch to the administration organization to manage customer {props.plural}.
        </p>
      </div>
    </section>
  );
}

/** Capability-specific empty state inside an otherwise valid administration scope. */
export function PlatformWorkspaceReadDenied(props: {
  singular: string;
  plural: string;
  canCreate: boolean;
  isMutating: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <p className="text-sm text-muted-foreground">
          Your administration role cannot view customer {props.plural}.
        </p>
        {props.canCreate && (
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={props.isMutating}
            onClick={props.onCreate}
          >
            Create {props.singular}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Accessible list-load failure rendered inside the master panel. */
export function PlatformWorkspaceLoadError(props: {
  error: Error | string;
  onRetry: () => void;
}) {
  const message = props.error instanceof Error ? props.error.message : props.error;
  return (
    <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <div role="alert">
        <p className="font-medium text-destructive">Unable to load customer workspaces</p>
        <p className="mt-1 text-muted-foreground">{message}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
