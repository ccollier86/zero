'use client';

/**
 * storage-dropzone.tsx
 *
 * Renders a reusable storage upload dropzone backed by Zero's upload queue.
 * This file owns dropzone presentation only; drag/drop behavior lives in
 * `useUploadDropzone` and storage transport remains in SDK-backed hooks.
 */

import * as React from 'react';
import type { Accept, FileRejection } from 'react-dropzone';
import { UploadCloud, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { FileInfo } from '../../storage/types';
import { useUploadDropzone, type UseUploadDropzoneReturn } from '../../storage/upload-dropzone-hooks';
import { formatStorageBytes } from './storage-format';

export interface StorageDropzoneProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onError' | 'title'> {
  driveId: string | null;
  path?: string | null;
  accept?: Accept;
  minSize?: number;
  maxSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  disabled?: boolean;
  overwrite?: boolean;
  public?: boolean;
  metadata?: Record<string, unknown>;
  title?: React.ReactNode;
  description?: React.ReactNode;
  showQueue?: boolean;
  chooseLabel?: string;
  onUploaded?: (files: FileInfo[]) => void;
  onRejected?: (rejections: FileRejection[]) => void;
  onUploadError?: (error: Error) => void;
  children?: (state: UseUploadDropzoneReturn) => React.ReactNode;
}

function formatRejection(rejection: FileRejection): string {
  const reason = rejection.errors[0]?.message;
  return reason ? `${rejection.file.name}: ${reason}` : `${rejection.file.name}: rejected`;
}

/** Render a ready-to-use storage upload dropzone. */
export function StorageDropzone({
  driveId,
  path,
  accept,
  minSize,
  maxSize,
  maxFiles,
  multiple = true,
  disabled,
  overwrite = true,
  public: isPublic,
  metadata,
  title = 'Drop files here',
  description = 'Upload files to this storage drive.',
  showQueue = true,
  chooseLabel = 'Choose files',
  onUploaded,
  onRejected,
  onUploadError,
  children,
  className,
  ...props
}: StorageDropzoneProps) {
  const state = useUploadDropzone({
    driveId,
    path,
    accept,
    minSize,
    maxSize,
    maxFiles,
    multiple,
    disabled,
    overwrite,
    public: isPublic,
    metadata,
    onUploaded,
    onRejected,
    onError: onUploadError,
  });
  const { dropzone, queue } = state;
  const rootProps = dropzone.getRootProps({
    ...props,
    'aria-disabled': state.disabled,
    className: cn(
      'group flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-8 text-center transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      dropzone.isDragActive && 'border-primary bg-primary/5',
      dropzone.isDragReject && 'border-destructive bg-destructive/5',
      state.disabled && 'cursor-not-allowed opacity-60',
      className,
    ),
  });

  if (children) return <>{children(state)}</>;

  return (
    <div className="space-y-3">
      <div {...rootProps}>
        <input {...dropzone.getInputProps()} />
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
          <UploadCloud className="size-6" />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {description && (
            <div className="mx-auto max-w-sm text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4"
          disabled={state.disabled || queue.uploading}
          onClick={(event) => {
            event.stopPropagation();
            dropzone.open();
          }}
        >
          <UploadCloud className="size-4" />
          {queue.uploading ? `${queue.progress}%` : chooseLabel}
        </Button>
      </div>

      {dropzone.fileRejections.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {dropzone.fileRejections.map((rejection) => (
            <div key={`${rejection.file.name}-${rejection.file.size}`}>
              {formatRejection(rejection)}
            </div>
          ))}
        </div>
      )}

      {showQueue && queue.items.length > 0 && (
        <div className="rounded-md border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-medium">
              {queue.completed.length} / {queue.items.length} uploaded
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Clear uploads"
              onClick={queue.clear}
            >
              <X className="size-3" />
            </Button>
          </div>
          <div className="divide-y">
            {queue.items.map((item) => (
              <div key={item.id} className="space-y-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatStorageBytes(item.size)}
                  </span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {item.status}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full bg-primary transition-[width]',
                      item.status === 'error' && 'bg-destructive',
                      item.status === 'cancelled' && 'bg-muted-foreground',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                  />
                </div>
                {item.error && <div className="text-xs text-destructive">{item.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
