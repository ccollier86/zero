'use client';

/** Safe built-in preview renderer for common browser-supported storage files. */

import * as React from 'react';
import { FileQuestion, LoaderCircle, RefreshCw } from 'lucide-react';
import type { FileInfo } from '../../storage/types';
import { Button } from '../ui/button';
import { useStorageFilePreview } from './use-storage-file-preview';

export interface StorageFilePreviewProps {
  readonly driveId: string;
  readonly file: FileInfo;
}

export function StorageFilePreview({ driveId, file }: StorageFilePreviewProps) {
  const preview = useStorageFilePreview(driveId, file);
  const [renderRevision, setRenderRevision] = React.useState(0);
  const previewIdentity = `${file.id}\0${file.updatedAt}\0${preview.status}\0${preview.url ?? ''}\0${renderRevision}`;
  const [renderFailure, setRenderFailure] = React.useState<{
    readonly identity: string;
    readonly message: string;
  } | null>(null);
  const renderError = renderFailure?.identity === previewIdentity
    ? renderFailure.message
    : null;
  const failRender = (message: string) => setRenderFailure({
    identity: previewIdentity,
    message,
  });
  const retry = () => {
    setRenderFailure(null);
    setRenderRevision((value) => value + 1);
    preview.refresh();
  };

  if (preview.status === 'loading' || preview.status === 'idle') {
    return <PreviewState icon={LoaderCircle} label="Preparing secure preview…" spinning />;
  }
  if (preview.status === 'error' || renderError) {
    return (
      <PreviewState
        icon={FileQuestion}
        label={renderError ?? preview.error ?? 'Preview could not be loaded.'}
        action={<Button size="sm" variant="outline" onClick={retry}><RefreshCw className="size-4" />Retry</Button>}
      />
    );
  }
  if (preview.status === 'unsupported') {
    return (
      <PreviewState
        icon={FileQuestion}
        label={preview.error ?? 'A safe in-browser preview is not available for this file type.'}
        detail="Use Download in the action bar to open the original file."
      />
    );
  }
  if (preview.kind === 'text') {
    return (
      <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/80 bg-muted/20 p-4 font-mono text-xs leading-relaxed text-foreground">
        {preview.text}
      </pre>
    );
  }
  if (!preview.url) return <PreviewState icon={FileQuestion} label="Preview is unavailable." />;
  if (preview.kind === 'image') {
    return (
      <div className="flex min-h-56 items-center justify-center overflow-hidden rounded-xl border border-border/80 bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)_50%/16px_16px] p-3">
        <img
          key={renderRevision}
          src={preview.url}
          alt={file.name}
          className="max-h-[34rem] max-w-full rounded-md object-contain"
          referrerPolicy="no-referrer"
          onError={() => failRender('The image preview could not be decoded.')}
        />
      </div>
    );
  }
  if (preview.kind === 'audio') {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-xl border border-border/80 bg-muted/20 p-6">
        <audio
          key={renderRevision}
          controls
          preload="metadata"
          src={preview.url}
          className="w-full max-w-lg"
          onError={() => failRender('The audio preview could not be decoded.')}
        >
          Audio preview is not supported by this browser.
        </audio>
      </div>
    );
  }
  if (preview.kind === 'video') {
    return (
      <video
        key={renderRevision}
        controls
        preload="metadata"
        src={preview.url}
        className="max-h-[34rem] w-full rounded-xl border border-border/80 bg-black"
        onError={() => failRender('The video preview could not be decoded.')}
      >
        Video preview is not supported by this browser.
      </video>
    );
  }
  return (
    <iframe
      key={renderRevision}
      src={preview.url}
      title={`Preview ${file.name}`}
      sandbox=""
      referrerPolicy="no-referrer"
      className="h-[34rem] w-full rounded-xl border border-border/80 bg-background"
      onError={() => failRender('The PDF preview could not be rendered.')}
    />
  );
}

function PreviewState({
  icon: Icon,
  label,
  detail,
  action,
  spinning = false,
}: {
  icon: typeof FileQuestion;
  label: string;
  detail?: string;
  action?: React.ReactNode;
  spinning?: boolean;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
      <Icon className={spinning ? 'mb-3 size-9 animate-spin text-primary/70' : 'mb-3 size-9 text-muted-foreground'} aria-hidden="true" />
      <p className="max-w-md text-sm font-medium">{label}</p>
      {detail && <p className="mt-1 max-w-md text-xs text-muted-foreground">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
