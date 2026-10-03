import * as React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import type { FileInfo } from '../../storage/types';
import type { StorageManagementController } from './storage-management-controller';
import { StorageManagement } from './storage-management';
import { StorageStudioFileSharing } from './storage-studio-file-inspector';
import { StorageStudioWorkspace } from './storage-studio-workspace';

describe('StorageStudioWorkspace', () => {
  test('keeps legacy StorageManagement props on the hook-backed adapter path', () => {
    const markup = renderToStaticMarkup(
      <StorageManagement initialDriveId={null} className="legacy-storage" />,
    );

    expect(markup).toContain('data-slot="storage-studio-workspace"');
    expect(markup).toContain('legacy-storage');
    expect(markup).toContain('No drives yet.');
  });

  test('renders one compact master/detail control plane for a selected drive', () => {
    const markup = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture()} />,
    );

    expect(markup).toContain('data-slot="storage-studio-workspace"');
    expect(markup).toContain('data-slot="storage-studio-toolbar"');
    expect(markup).toContain('data-slot="storage-studio-list"');
    expect(markup).toContain('data-slot="storage-studio-inspector"');
    expect(markup).toContain('data-slot="storage-studio-action-bar"');
    expect(markup).toContain('>overview</button>');
    expect(markup).toContain('>access</button>');
    expect(markup).toContain('>settings</button>');
    expect(markup).toContain('>usage</button>');
    expect(markup).toContain('>jobs</button>');
    expect(markup).toContain('New Drive');
    expect(markup).toContain('aria-label="Open"');
    expect(markup).not.toContain('Drop files into this folder');
  });

  test('hides privileged actions instead of advertising unavailable authority', () => {
    const drive = driveFixture({ canAdmin: false, canWrite: false, isOwner: false });
    const controller = controllerFixture({
      capabilities: {
        ...capabilitiesFixture(),
        canProvisionOrganization: false,
        canProvisionPersonal: false,
        canManage: false,
        canDelete: false,
      },
      drives: [drive],
      selectedDrive: drive,
      operations: {
        createDrive: () => undefined,
        renameDrive: () => undefined,
        suspend: () => undefined,
        restore: () => undefined,
        deleteDrive: () => undefined,
      },
    });
    const markup = renderToStaticMarkup(<StorageStudioWorkspace controller={controller} />);

    expect(markup).not.toContain('New Drive');
    expect(markup).not.toContain('aria-label="Rename"');
    expect(markup).not.toContain('aria-label="Suspend"');
    expect(markup).not.toContain('aria-label="Restore"');
    expect(markup).not.toContain('aria-label="Delete"');
    expect(markup).toContain('aria-label="Open"');
  });

  test('keeps visible actions disabled while lifecycle work makes them unsafe', () => {
    const ready = driveFixture();
    const provisioning: StorageStudioDrive = {
      ...ready,
      profile: { ...ready.profile, lifecycle: 'provisioning', readyAt: null },
      control: { ...ready.control, canSuspend: false },
    };
    const markup = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture({
        drives: [provisioning],
        selectedDrive: provisioning,
      })} />,
    );

    expect(markup).toMatch(/disabled=""[^>]*aria-label="Open"/u);
    expect(markup).not.toContain('aria-label="Suspend"');
  });

  test('renders bounded cursor pagination only when another page is reachable', () => {
    const markup = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture({
        drivePagination: {
          page: 2,
          count: 1,
          hasPrevious: true,
          hasNext: true,
        },
        previousDrivePage: () => undefined,
        nextDrivePage: () => undefined,
      })} />,
    );

    expect(markup).toContain('data-slot="storage-studio-pagination"');
    expect(markup).toContain('Page <span class="font-medium text-foreground">2</span>');
    expect(markup).toContain('aria-label="Previous page"');
    expect(markup).toContain('aria-label="Next page"');
  });

  test('switches the same workspace into folder contents and file-aware actions', () => {
    const file = fileFixture();
    const controller = controllerFixture({
      view: 'files',
      files: [file],
      selectedFile: file,
      selectedFileAccess: driveFixture().drive.access,
      currentPath: '/reports',
      breadcrumbs: [
        { label: 'Root', path: null },
        { label: 'reports', path: '/reports' },
      ],
      operations: {
        upload: () => undefined,
        createFolder: () => undefined,
        download: () => undefined,
        renameFile: () => undefined,
        move: () => undefined,
        copy: () => undefined,
        share: () => undefined,
        deleteFile: () => undefined,
      },
    });
    const markup = renderToStaticMarkup(<StorageStudioWorkspace controller={controller} />);

    expect(markup).toContain('data-view="files"');
    expect(markup).toContain('>preview</button>');
    expect(markup).toContain('>details</button>');
    expect(markup).toContain('>sharing</button>');
    expect(markup).toContain('New Folder');
    expect(markup).toContain('Upload');
    expect(markup).toContain('aria-label="Download"');
    expect(markup).toContain('aria-label="Move"');
    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('aria-label="Share"');
  });

  test('waits for the selected path capability before offering inline mutation', () => {
    const file = fileFixture();
    const base = {
      view: 'files' as const,
      files: [file],
      operations: { renameFile: () => undefined },
    };
    const unselected = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture(base)} />,
    );
    const pathReadOnly = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture({
        ...base,
        selectedFile: file,
        selectedFileAccess: {
          ...driveFixture().drive.access,
          effectiveAccess: 'read',
          canWrite: false,
          canAdmin: false,
        },
      })} />,
    );

    expect(unselected).toContain('aria-label="Select file name');
    expect(pathReadOnly).toContain('aria-label="Select file name');
    expect(pathReadOnly).not.toContain('aria-label="Edit file name');
  });

  test('gates folder creation and upload by current-folder access, not drive access', () => {
    const readOnlyDrive = driveFixture({ canWrite: false });
    const markup = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture({
        view: 'files',
        drives: [readOnlyDrive],
        selectedDrive: readOnlyDrive,
        currentPath: '/delegated',
        currentPathAccess: {
          ...readOnlyDrive.drive.access,
          effectiveAccess: 'write',
          canWrite: true,
        },
        operations: {
          createFolder: () => undefined,
          upload: () => undefined,
        },
      })} />,
    );

    expect(markup).toContain('New Folder');
    expect(markup).toContain('Upload');
  });

  test('does not offer file-only copy or temporary-link actions for folders', () => {
    const folder: FileInfo = {
      ...fileFixture(),
      id: 'folder-1',
      name: 'reports',
      path: '/reports',
      type: 'folder',
      mimeType: null,
    };
    const markup = renderToStaticMarkup(
      <StorageStudioWorkspace controller={controllerFixture({
        view: 'files',
        files: [folder],
        selectedFile: folder,
        selectedFileAccess: driveFixture().drive.access,
        operations: {
          move: () => undefined,
          copy: () => undefined,
          share: () => undefined,
        },
      })} />,
    );

    expect(markup).toContain('aria-label="Move"');
    expect(markup).not.toContain('aria-label="Copy"');
    expect(markup).not.toContain('aria-label="Share"');
  });

  test('separates policy-approved public visibility from temporary links', () => {
    const file = fileFixture();
    const controller = controllerFixture({
      capabilities: {
        ...capabilitiesFixture(),
        policy: { ...capabilitiesFixture().policy, allowPublicObjects: true },
      },
      view: 'files',
      files: [file],
      selectedFile: file,
      selectedFileAccess: driveFixture().drive.access,
      operations: {
        share: () => undefined,
        setFileVisibility: () => undefined,
      },
    });
    const markup = renderToStaticMarkup(
      <StorageStudioFileSharing controller={controller} file={file} />,
    );

    expect(markup).toContain('Public visibility');
    expect(markup).toContain('Make public');
    expect(markup).toContain('Temporary link');
  });

  test('keeps private remediation available for an existing public object after policy tightens', () => {
    const file = { ...fileFixture(), isPublic: true };
    const controller = controllerFixture({
      capabilities: {
        ...capabilitiesFixture(),
        policy: { ...capabilitiesFixture().policy, allowPublicObjects: false },
      },
      view: 'files',
      files: [file],
      selectedFile: file,
      selectedFileAccess: driveFixture().drive.access,
      operations: { setFileVisibility: () => undefined },
    });

    const markup = renderToStaticMarkup(
      <StorageStudioFileSharing controller={controller} file={file} />,
    );
    expect(markup).toContain('Make private');
  });
});

function controllerFixture(
  overrides: Partial<StorageManagementController> = {},
): StorageManagementController {
  const drive = driveFixture();
  return {
    status: 'ready',
    capabilities: capabilitiesFixture(),
    view: 'drives',
    drives: [drive],
    files: [],
    selectedDrive: drive,
    selectedFile: null,
    selectedFileAccess: null,
    currentPath: null,
    breadcrumbs: [{ label: 'Root', path: null }],
    usage: {
      driveId: drive.drive.drive_id,
      name: drive.drive.name,
      totalBytes: 128,
      maxBytes: 1_024,
      fileCount: 1,
      folderCount: 0,
      percentUsed: 12.5,
    },
    jobs: [],
    filters: {
      search: '',
      owner: 'all',
      lifecycle: 'all',
      objectType: 'all',
      sortBy: 'name',
      sortDir: 'asc',
    },
    setSearch: () => undefined,
    setOwnerFilter: () => undefined,
    setLifecycleFilter: () => undefined,
    setObjectTypeFilter: () => undefined,
    setSortBy: () => undefined,
    setSortDir: () => undefined,
    selectDrive: () => undefined,
    openDrive: () => undefined,
    selectFile: () => undefined,
    openFolder: () => undefined,
    openBreadcrumb: () => undefined,
    showDriveCatalog: () => undefined,
    refresh: () => undefined,
    operations: {
      createDrive: () => undefined,
      renameDrive: () => undefined,
      deleteDrive: () => undefined,
    },
    ...overrides,
  };
}

function capabilitiesFixture() {
  return {
    enabled: true as const,
    scopeKind: 'tenant' as const,
    ownerChoices: ['organization', 'personal'] as const,
    canReadCatalog: true,
    canProvisionOrganization: true,
    canProvisionPersonal: true,
    canManage: true,
    canDelete: true,
    policy: {
      isolation: 'shared-cas' as const,
      allowPublicDrives: false,
      allowPublicObjects: false,
      maxCapabilityTTL: 3_600,
      maxOrganizationDrives: 25,
      maxPersonalDrivesPerUser: 2,
      defaultDriveSizeBytes: 1_024,
      defaultFileSizeBytes: 512,
      maxDriveSizeBytes: 2_048,
      maxFileSizeBytes: 1_024,
      maxObjectsPerDrive: 100,
      maxConcurrentUploadBytes: 1_024,
    },
  };
}

function driveFixture(
  accessOverrides: Partial<StorageStudioDrive['drive']['access']> = {},
): StorageStudioDrive {
  const createdAt = Date.UTC(2026, 9, 3, 12);
  return {
    drive: {
      drive_id: 'drive-1',
      tenant_id: 'tenant-1',
      name: 'Clinical files',
      owner_id: 'user-1',
      max_size_bytes: 1_024,
      max_file_size_bytes: 512,
      allowed_mime_types: '*',
      public: 0,
      created_at: createdAt,
      access: {
        effectiveAccess: 'admin',
        canRead: true,
        canWrite: true,
        canAdmin: true,
        isOwner: true,
        isPlatformAdmin: false,
        isPublic: false,
        ...accessOverrides,
      },
    },
    profile: {
      driveId: 'drive-1',
      key: 'clinical-files',
      ownerKind: 'organization',
      ownerId: 'tenant-1',
      scopeKind: 'tenant',
      lifecycle: 'ready',
      revision: 4,
      isolation: 'shared-cas',
      generation: 1,
      createdAt,
      updatedAt: createdAt,
      readyAt: createdAt,
      degradedAt: null,
      suspendedAt: null,
      deletingAt: null,
      deletedAt: null,
      restoringAt: null,
      failedAt: null,
      failureCode: null,
    },
    control: {
      canManage: accessOverrides.canAdmin ?? true,
      canDelete: accessOverrides.canAdmin ?? true,
      canSuspend: accessOverrides.canAdmin ?? true,
      canRestore: false,
    },
  };
}

function fileFixture(): FileInfo {
  const timestamp = Date.UTC(2026, 9, 3, 12);
  return {
    id: 'file-1',
    driveId: 'drive-1',
    name: 'assessment.pdf',
    path: '/reports/assessment.pdf',
    type: 'file',
    mimeType: 'application/pdf',
    sizeBytes: 256,
    checksum: 'abc123',
    isPublic: false,
    metadata: { category: 'assessment' },
    createdBy: 'user-1',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
