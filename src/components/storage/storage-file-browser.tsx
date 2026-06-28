'use client';

/**
 * storage-file-browser.tsx
 *
 * Renders and wires file/folder management for one storage drive. This file
 * owns browser interaction state only; storage transport remains in hooks and
 * action failure reporting remains in storage-observability.
 */

import * as React from 'react';
import { ChevronRight, File, Folder } from 'lucide-react';
import { toast } from 'sonner';
import { AnimateIcon } from '../animate-ui/icons/icon';
import { ArrowLeft } from '../animate-ui/icons/arrow-left';
import { Plus } from '../animate-ui/icons/plus';
import { Upload } from '../animate-ui/icons/upload';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { modals } from '../../modals';
import {
  useDriveUsage,
  useStorageActions,
  useStorageFolder,
  useUpload,
} from '../../storage/storage-hooks';
import type { FileInfo } from '../../storage/types';
import {
  formatStorageBytes,
  joinStoragePath,
  renameStoragePath,
} from './storage-format';
import { openStorageNameDialog } from './storage-name-dialog';
import { reportStorageActionError } from './storage-observability';
import { StorageFileDetailPanel } from './storage-file-detail-panel';

export interface StorageFileBrowserProps {
  driveId: string;
  onBack: () => void;
  className?: string;
}

interface StorageBreadcrumb {
  label: string;
  path: string | undefined;
}

/** Render a file browser for one storage drive. */
export function StorageFileBrowser({
  driveId,
  onBack,
  className,
}: StorageFileBrowserProps) {
  const [currentPath, setCurrentPath] = React.useState<string | undefined>(undefined);
  const [selectedFile, setSelectedFile] = React.useState<FileInfo | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { items, loading, error, refresh } = useStorageFolder(driveId, currentPath);
  const { usage } = useDriveUsage(driveId);
  const actions = useStorageActions();
  const { upload, uploading, progress, error: uploadError } = useUpload();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const breadcrumbs = React.useMemo(
    () => createBreadcrumbs(currentPath),
    [currentPath],
  );

  const runAction = React.useCallback(
    async (
      action: string,
      task: () => Promise<void>,
      metadata?: Record<string, unknown>,
    ) => {
      setBusy(true);
      setActionError(null);
      try {
        await task();
      } catch (err) {
        const normalized = reportStorageActionError(action, err, metadata);
        setActionError(normalized.message);
        toast.error(normalized.message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleSelectItem = React.useCallback((item: FileInfo) => {
    setSelectedFile(item);
  }, []);

  const handleOpenFolder = React.useCallback((item: FileInfo) => {
    if (item.type !== 'folder') return;
    setCurrentPath(item.path);
    setSelectedFile(null);
  }, []);

  const handleUpload = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const path = joinStoragePath(currentPath, file.name);
      void runAction('uploadFile', async () => {
        await upload(driveId, file, { path, overwrite: true });
        refresh();
        toast.success('File uploaded');
      }, { driveId, path });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [currentPath, driveId, refresh, runAction, upload],
  );

  const handleNewFolder = React.useCallback(() => {
    void runAction('createFolder', async () => {
      const name = await openStorageNameDialog({
        title: 'New folder',
        label: 'Folder name',
        placeholder: 'Invoices',
        submitLabel: 'Create folder',
      });
      if (!name) return;
      const path = joinStoragePath(currentPath, name);
      await actions.createFolder(driveId, path);
      refresh();
      toast.success('Folder created');
    }, { driveId, currentPath });
  }, [actions, currentPath, driveId, refresh, runAction]);

  const handleRename = React.useCallback(
    (file: FileInfo) => {
      void runAction('renameFile', async () => {
        const name = await openStorageNameDialog({
          title: file.type === 'folder' ? 'Rename folder' : 'Rename file',
          label: 'New name',
          initialValue: file.name,
          submitLabel: 'Rename',
        });
        if (!name || name === file.name) return;
        const nextPath = renameStoragePath(file.path, name);
        await actions.moveFile(driveId, file.path, nextPath);
        setSelectedFile(null);
        refresh();
        toast.success('Renamed');
      }, { driveId, path: file.path });
    },
    [actions, driveId, refresh, runAction],
  );

  const handleDelete = React.useCallback(
    (file: FileInfo) => {
      void runAction('deleteFile', async () => {
        const confirmed = await modals.confirm({
          title: file.type === 'folder' ? 'Delete folder?' : 'Delete file?',
          description: `${file.name} will be permanently deleted.`,
          confirmLabel: 'Delete',
          variant: 'destructive',
          holdToConfirm: true,
        });
        if (!confirmed) return;
        await actions.deleteFile(driveId, file.path);
        setSelectedFile(null);
        refresh();
        toast.success(file.type === 'folder' ? 'Folder deleted' : 'File deleted');
      }, { driveId, path: file.path });
    },
    [actions, driveId, refresh, runAction],
  );

  const handleToggleVisibility = React.useCallback(
    (file: FileInfo) => {
      void runAction('setFileVisibility', async () => {
        await actions.setVisibility(driveId, !file.isPublic, file.path);
        setSelectedFile((current) =>
          current?.id === file.id ? { ...current, isPublic: !file.isPublic } : current,
        );
        refresh();
        toast.success(file.isPublic ? 'Item is private' : 'Item is public');
      }, { driveId, path: file.path });
    },
    [actions, driveId, refresh, runAction],
  );

  const visibleError = actionError ?? error ?? uploadError;

  return (
    <div className={cn('flex h-full min-h-[32rem] flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <AnimateIcon animateOnHover>
            <ArrowLeft size={16} className="mr-1" />
          </AnimateIcon>
          Drives
        </Button>

        <div className="hidden h-4 w-px bg-border sm:block" />

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm">
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path ?? 'root'}>
              {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => {
                  setCurrentPath(crumb.path);
                  setSelectedFile(null);
                }}
                className={cn(
                  'min-w-0 truncate rounded px-1 py-0.5 hover:bg-accent',
                  index === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {usage && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatStorageBytes(usage.totalBytes)} used
            {usage.maxBytes > 0 && ` / ${formatStorageBytes(usage.maxBytes)}`}
          </span>
        )}

        <Button variant="outline" size="sm" disabled={busy} onClick={handleNewFolder}>
          <AnimateIcon animateOnHover>
            <Plus size={16} className="mr-1" />
          </AnimateIcon>
          Folder
        </Button>

        <Button
          variant="default"
          size="sm"
          disabled={uploading || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <AnimateIcon animateOnHover>
            <Upload size={16} className="mr-1" />
          </AnimateIcon>
          {uploading ? `${progress}%` : 'Upload'}
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {visibleError && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {visibleError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="min-h-0 flex-1 overflow-auto border-r-0 md:border-r">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground">
              <Folder className="mb-2 size-8 opacity-50" />
              Empty folder
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'flex w-full items-center gap-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    selectedFile?.id === item.id && 'bg-accent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectItem(item)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {item.type === 'folder' ? (
                      <Folder className="size-4 shrink-0 text-primary" />
                    ) : (
                      <File className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.type === 'file' && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatStorageBytes(item.sizeBytes)}
                      </span>
                    )}
                    {item.isPublic && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        Public
                      </Badge>
                    )}
                  </button>
                  {item.type === 'folder' && (
                    <button
                      type="button"
                      aria-label={`Open ${item.name}`}
                      onClick={() => handleOpenFolder(item)}
                      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="min-h-[16rem] border-t p-4 md:min-h-0 md:w-80 md:border-l-0 md:border-t-0">
          {selectedFile ? (
            <StorageFileDetailPanel
              file={selectedFile}
              downloadUrl={actions.getFileUrl(driveId, selectedFile.path)}
              busy={busy}
              onRename={handleRename}
              onDelete={handleDelete}
              onToggleVisibility={handleToggleVisibility}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to view details
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function createBreadcrumbs(currentPath: string | undefined): StorageBreadcrumb[] {
  if (!currentPath) return [{ label: 'Root', path: undefined }];
  const parts = currentPath.split('/').filter(Boolean);
  const crumbs: StorageBreadcrumb[] = [{ label: 'Root', path: undefined }];
  let built = '';
  for (const part of parts) {
    built += `/${part}`;
    crumbs.push({ label: part, path: built });
  }
  return crumbs;
}
