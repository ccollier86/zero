'use client';

import * as React from 'react';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { FolderOpen, Pencil, ChevronRight, File, Folder } from 'lucide-react';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Trash } from '@/components/animate-ui/icons/trash';
import { Eye } from '@/components/animate-ui/icons/eye';
import { EyeOff } from '@/components/animate-ui/icons/eye-off';
import { Plus } from '@/components/animate-ui/icons/plus';
import { Upload } from '@/components/animate-ui/icons/upload';
import { Download } from '@/components/animate-ui/icons/download';
import { ArrowLeft } from '@/components/animate-ui/icons/arrow-left';
import { MasterDetailPage } from '@/components/master-detail';
import type { NavigationAction } from '@/components/ui/record-navigation-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DriveDetailHeader } from './drive-detail-header';
import { driveSchema, driveListColumns, driveEditableFields } from './drive-schema';
import {
  useStorageDrives,
  useDriveUsage,
  useStorageFolder,
  useStorageActions,
  useUpload,
} from '../../storage/storage-hooks';
import type { Row } from '../../sync/types';
import type { FileInfo, DriveRecord } from '../../storage/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DriveRow extends Row {
  id: string;
  name: string;
  max_size_bytes: number;
  max_file_size_bytes: number;
  allowed_mime_types: string;
  public: number | string;
  owner_id: string | null;
  _usedBytes?: number;
  _fileCount?: number;
  _folderCount?: number;
}

export interface StorageManagementPageProps {
  className?: string;
}

// ─── Drive view ─────────────────────────────────────────────────────────────

function StorageManagementPage({ className }: StorageManagementPageProps) {
  const [view, setView] = useState<'drives' | 'files'>('drives');
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);

  if (view === 'files' && selectedDriveId) {
    return (
      <FileBrowserView
        driveId={selectedDriveId}
        onBack={() => setView('drives')}
        className={className}
      />
    );
  }

  return (
    <DriveListView
      className={className}
      onBrowse={(driveId) => {
        setSelectedDriveId(driveId);
        setView('files');
      }}
    />
  );
}

// Stable component reference — must be defined outside render to avoid remount
function DriveDetailHeaderAdapter({ item }: { item: DriveRow }) {
  return <DriveDetailHeader drive={item} />;
}

// ─── Drive list (MasterDetail) ──────────────────────────────────────────────

interface DriveListViewProps {
  className?: string;
  onBrowse: (driveId: string) => void;
}

function DriveListView({ className, onBrowse }: DriveListViewProps) {
  const { drives, refresh } = useStorageDrives();
  const actions = useStorageActions();

  // Map DriveRecord[] → DriveRow[] (MasterDetailPage needs `id` field)
  const data: DriveRow[] = useMemo(
    () =>
      drives.map((d) => ({
        id: d.drive_id,
        name: d.name,
        max_size_bytes: d.max_size_bytes,
        max_file_size_bytes: d.max_file_size_bytes,
        allowed_mime_types: d.allowed_mime_types,
        public: d.public,
        owner_id: d.owner_id,
      })),
    [drives],
  );

  const handleCreate = useCallback(async () => {
    await actions.createDrive('New Drive');
    refresh();
  }, [actions, refresh]);

  const handleDelete = useCallback(
    async (driveId: string) => {
      await actions.deleteDrive(driveId);
      refresh();
    },
    [actions, refresh],
  );

  const handleToggleVisibility = useCallback(
    async (drive: DriveRow) => {
      const isPublic = drive.public === 1 || drive.public === '1';
      await actions.setVisibility(drive.id, !isPublic);
      refresh();
    },
    [actions, refresh],
  );

  const navigationActions = useCallback(
    (drive: DriveRow | null): NavigationAction[] => [
      {
        icon: <FolderOpen size={20} />,
        label: 'Browse Files',
        variant: 'default',
        onClick: () => { if (drive) onBrowse(drive.id); },
        disabled: !drive,
      },
      {
        icon: drive?.public === 1 || drive?.public === '1'
          ? <AnimateIcon animate><EyeOff size={20} /></AnimateIcon>
          : <AnimateIcon animate><Eye size={20} /></AnimateIcon>,
        label: drive?.public === 1 || drive?.public === '1' ? 'Make Private' : 'Make Public',
        variant: 'default',
        onClick: () => { if (drive) handleToggleVisibility(drive); },
        disabled: !drive,
      },
      {
        icon: <AnimateIcon animateOnHover><Trash size={20} /></AnimateIcon>,
        label: 'Delete',
        variant: 'destructive',
        onClick: () => { if (drive) handleDelete(drive.id); },
        disabled: !drive,
      },
    ],
    [onBrowse, handleDelete, handleToggleVisibility],
  );

  return (
    <MasterDetailPage<DriveRow>
      schema={driveSchema}
      listColumns={driveListColumns}
      editableFields={driveEditableFields}
      data={data}
      detailHeader={DriveDetailHeaderAdapter}
      navigationActions={navigationActions}
      emptyStateText="No drives yet. Create one to get started."
      primaryAction={{
        label: 'New Drive',
        shortcut: '⌘N',
        onClick: handleCreate,
      }}
      className={className}
    />
  );
}

// ─── File browser ───────────────────────────────────────────────────────────

interface FileBrowserViewProps {
  driveId: string;
  onBack: () => void;
  className?: string;
}

function FileBrowserView({ driveId, onBack, className }: FileBrowserViewProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const { items, loading, refresh } = useStorageFolder(driveId, currentPath);
  const { usage } = useDriveUsage(driveId);
  const actions = useStorageActions();
  const { upload, uploading, progress } = useUpload();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Build breadcrumb parts
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [{ label: 'Root', path: undefined as string | undefined }];
    const parts = currentPath.split('/').filter(Boolean);
    const crumbs = [{ label: 'Root', path: undefined as string | undefined }];
    let built = '';
    for (const part of parts) {
      built += '/' + part;
      crumbs.push({ label: part, path: built });
    }
    return crumbs;
  }, [currentPath]);

  const handleNavigate = useCallback((item: FileInfo) => {
    if (item.type === 'folder') {
      setCurrentPath(item.path);
      setSelectedFile(null);
    } else {
      setSelectedFile(item);
    }
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = currentPath ? `${currentPath}/${file.name}` : `/${file.name}`;
    await upload(driveId, file, { path, overwrite: true });
    refresh();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [driveId, currentPath, upload, refresh]);

  const handleDelete = useCallback(async (path: string) => {
    await actions.deleteFile(driveId, path);
    setSelectedFile(null);
    refresh();
  }, [driveId, actions, refresh]);

  const handleNewFolder = useCallback(async () => {
    const name = prompt('Folder name:');
    if (!name) return;
    const path = currentPath ? `${currentPath}/${name}` : `/${name}`;
    await actions.createFolder(driveId, path);
    refresh();
  }, [driveId, currentPath, actions, refresh]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <AnimateIcon animateOnHover><ArrowLeft size={16} className="mr-1" /></AnimateIcon> Drives
        </Button>

        <div className="mx-2 h-4 w-px bg-border" />

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path ?? 'root'}>
              {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
              <button
                onClick={() => setCurrentPath(crumb.path)}
                className={cn(
                  'rounded px-1 py-0.5 hover:bg-accent',
                  i === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1" />

        {usage && (
          <span className="text-xs text-muted-foreground">
            {formatBytes(usage.totalBytes)} used
            {usage.maxBytes > 0 && ` / ${formatBytes(usage.maxBytes)}`}
          </span>
        )}

        <Button variant="outline" size="sm" onClick={handleNewFolder}>
          <AnimateIcon animateOnHover><Plus size={16} className="mr-1" /></AnimateIcon> Folder
        </Button>

        <Button variant="default" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <AnimateIcon animateOnHover><Upload size={16} className="mr-1" /></AnimateIcon>
          {uploading ? `${progress}%` : 'Upload'}
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {/* Content: file list + detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <div className="flex-1 overflow-auto border-r">
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
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                    selectedFile?.id === item.id && 'bg-accent',
                  )}
                >
                  {item.type === 'folder' ? (
                    <Folder className="size-4 text-primary" />
                  ) : (
                    <File className="size-4 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{item.name}</span>
                  {item.type === 'file' && (
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(item.sizeBytes)}
                    </span>
                  )}
                  {item.isPublic && (
                    <Badge variant="outline" className="text-xs">Public</Badge>
                  )}
                  {item.type === 'folder' && (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="w-80 overflow-auto p-4">
          {selectedFile ? (
            <FileDetailPanel
              file={selectedFile}
              driveId={driveId}
              onDelete={handleDelete}
              onRefresh={refresh}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── File detail panel ──────────────────────────────────────────────────────

interface FileDetailPanelProps {
  file: FileInfo;
  driveId: string;
  onDelete: (path: string) => void;
  onRefresh: () => void;
}

function FileDetailPanel({ file, driveId, onDelete, onRefresh }: FileDetailPanelProps) {
  const actions = useStorageActions();
  const fileUrl = actions.getFileUrl(driveId, file.path);

  const handleToggleVisibility = useCallback(async () => {
    await actions.setVisibility(driveId, !file.isPublic, file.path);
    onRefresh();
  }, [actions, driveId, file, onRefresh]);

  const handleRename = useCallback(async () => {
    const newName = prompt('New name:', file.name);
    if (!newName || newName === file.name) return;
    const parentPath = file.path.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : `/${newName}`;
    await actions.moveFile(driveId, file.path, newPath);
    onRefresh();
  }, [actions, driveId, file, onRefresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <File className="size-5 text-muted-foreground" />
        <h3 className="truncate text-sm font-semibold">{file.name}</h3>
      </div>

      <div className="space-y-2 text-xs">
        <DetailRow label="Path" value={file.path} />
        <DetailRow label="Size" value={formatBytes(file.sizeBytes)} />
        <DetailRow label="Type" value={file.mimeType ?? 'Unknown'} />
        <DetailRow label="Checksum" value={file.checksum ? file.checksum.slice(0, 16) + '...' : 'N/A'} />
        <DetailRow label="Created" value={new Date(file.createdAt).toLocaleString()} />
        <DetailRow label="Updated" value={new Date(file.updatedAt).toLocaleString()} />
        <DetailRow
          label="Visibility"
          value={
            <Badge variant={file.isPublic ? 'default' : 'secondary'} className="text-xs">
              {file.isPublic ? 'Public' : 'Private'}
            </Badge>
          }
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-2">
        <Button variant="outline" size="sm" asChild>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <AnimateIcon animateOnHover><Download size={12} className="mr-1" /></AnimateIcon> Download
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={handleRename}>
          <Pencil className="mr-1 size-3" /> Rename
        </Button>
        <Button variant="outline" size="sm" onClick={handleToggleVisibility}>
          {file.isPublic
            ? <AnimateIcon animate><EyeOff size={12} className="mr-1" /></AnimateIcon>
            : <AnimateIcon animate><Eye size={12} className="mr-1" /></AnimateIcon>}
          {file.isPublic ? 'Make Private' : 'Make Public'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(file.path)}
        >
          <AnimateIcon animateOnHover><Trash size={12} className="mr-1" /></AnimateIcon> Delete
        </Button>
      </div>
    </div>
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-mono">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export { StorageManagementPage };
