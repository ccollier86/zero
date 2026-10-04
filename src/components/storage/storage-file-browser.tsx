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
import { DataTableControls } from '../data-table/data-table-controls';
import { DataTableSearch } from '../data-table/data-table-search';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';
import { modals } from '../../modals';
import {
  useDriveCapabilities,
  useDriveUsage,
  usePresignedUrl,
  useStorageActions,
  useStorageFolder,
} from '../../storage/storage-hooks';
import type { FileInfo, ListOptions } from '../../storage/types';
import {
  formatStorageBytes,
  joinStoragePath,
  renameStoragePath,
} from './storage-format';
import { openStorageNameDialog } from './storage-name-dialog';
import { reportStorageActionError } from './storage-observability';
import { StorageDropzone } from './storage-dropzone';
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
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<ListOptions['type']>('all');
  const [sortBy, setSortBy] = React.useState<ListOptions['sortBy']>('name');
  const [sortDir, setSortDir] = React.useState<ListOptions['sortDir']>('asc');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { items, loading, error, refresh } = useStorageFolder(driveId, currentPath, {
    type: typeFilter,
    sortBy,
    sortDir,
  });
  const { usage } = useDriveUsage(driveId);
  const rootAccess = useDriveCapabilities(driveId);
  const selectedAccess = useDriveCapabilities(selectedFile ? driveId : null, selectedFile?.path);
  const actions = useStorageActions();
  const presigned = usePresignedUrl();

  const breadcrumbs = React.useMemo(
    () => createBreadcrumbs(currentPath),
    [currentPath],
  );
  const visibleItems = React.useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      item.name.toLowerCase().includes(normalized)
      || item.path.toLowerCase().includes(normalized)
      || item.mimeType?.toLowerCase().includes(normalized),
    );
  }, [items, search]);
  const canWrite = rootAccess.capabilities?.canWrite === true;
  const canAdmin = rootAccess.capabilities?.canAdmin === true;
  const fileCapabilities = selectedAccess.capabilities ?? rootAccess.capabilities;

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

  const handleUploaded = React.useCallback(
    (files: FileInfo[]) => {
      refresh();
      toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
    },
    [refresh],
  );

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

  const handleDownload = React.useCallback(
    (file: FileInfo) => {
      void runAction('downloadFile', async () => {
        const url = await presigned.getUrl(driveId, file.path, 'download');
        window.open(url, '_blank', 'noopener,noreferrer');
      }, { driveId, path: file.path });
    },
    [driveId, presigned, runAction],
  );

  const handleCopyLink = React.useCallback(
    (file: FileInfo) => {
      void runAction('copyPresignedLink', async () => {
        const url = await presigned.getUrl(driveId, file.path, 'download');
        if (!navigator.clipboard) {
          throw new Error('Clipboard API is not available');
        }
        await navigator.clipboard.writeText(url);
        toast.success('Temporary link copied');
      }, { driveId, path: file.path });
    },
    [driveId, presigned, runAction],
  );

  const visibleError = actionError ?? error ?? rootAccess.error ?? selectedAccess.error;

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

        <Button variant="outline" size="sm" disabled={busy || !canWrite} onClick={handleNewFolder}>
          <AnimateIcon animateOnHover>
            <Plus size={16} className="mr-1" />
          </AnimateIcon>
          Folder
        </Button>
      </div>

      <div className="border-b px-4 py-3">
        <DataTableControls
          aria-label="Storage file controls"
          search={(
            <DataTableSearch
              value={search}
              onValueChange={setSearch}
              label="Search files"
              placeholder="Search files"
              collapsedWidth={112}
              expandedWidth={216}
              className="max-w-full"
            />
          )}
          controls={(
            <>
              <Select
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as ListOptions['type'])}
              >
                <SelectTrigger
                  className="h-8 w-[8.25rem] max-w-full"
                  aria-label="Filter storage objects by type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All items</SelectItem>
                  <SelectItem value="folder">Folders</SelectItem>
                  <SelectItem value="file">Files</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as ListOptions['sortBy'])}
              >
                <SelectTrigger
                  className="h-8 w-[8.25rem] max-w-full"
                  aria-label="Sort storage objects"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="updated_at">Updated</SelectItem>
                  <SelectItem value="created_at">Created</SelectItem>
                  <SelectItem value="size">Size</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sortDir}
                onValueChange={(value) => setSortDir(value as ListOptions['sortDir'])}
              >
                <SelectTrigger
                  className="h-8 w-[7.75rem] max-w-full"
                  aria-label="Sort direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Ascending</SelectItem>
                  <SelectItem value="desc">Descending</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        />
      </div>

      {visibleError && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {visibleError}
        </div>
      )}

      {canWrite && (
        <div className="border-b px-4 py-3">
          <StorageDropzone
            driveId={driveId}
            path={currentPath}
            overwrite
            title="Drop files into this folder"
            description="Uploads use the current path and keep folder state refreshed."
            chooseLabel="Choose files"
            className="min-h-32 py-5"
            onUploaded={handleUploaded}
            onUploadError={(err) => toast.error(err.message)}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="min-h-0 flex-1 overflow-auto border-r-0 md:border-r">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground">
              <Folder className="mb-2 size-8 opacity-50" />
              {search ? 'No matching storage objects' : 'Empty folder'}
            </div>
          ) : (
            <div className="divide-y">
              {visibleItems.map((item) => (
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
              busy={busy}
              canWrite={fileCapabilities?.canWrite === true}
              canAdmin={fileCapabilities?.canAdmin === true || canAdmin}
              onDownload={handleDownload}
              onCopyLink={handleCopyLink}
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
