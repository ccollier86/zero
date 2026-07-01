/**
 * registry.ts
 *
 * Defines source-copy targets supported by `zero add`. This file owns the
 * addable item registry only; filesystem copying and CLI output live elsewhere.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Describes one supported source-copy target for `zero add`. */
export interface AddableTarget {
  id: string;
  sourceRel: string;
  description: string;
}

const STATIC_TARGETS: AddableTarget[] = [
  {
    id: 'components/auth',
    sourceRel: 'components/auth',
    description: 'Auth forms, password flows, and auth visibility gates.',
  },
  {
    id: 'components/data-table',
    sourceRel: 'components/data-table',
    description: 'DataTable, DataTableView, toolbar, pagination, and row actions.',
  },
  {
    id: 'components/hero',
    sourceRel: 'components/hero',
    description: 'Public-page Hero section with tokenized backgrounds and actions.',
  },
  {
    id: 'components/kanban',
    sourceRel: 'components/kanban',
    description: 'Tokenized drag-and-drop Kanban board organism.',
  },
  {
    id: 'components/master-detail',
    sourceRel: 'components/master-detail',
    description: 'Master-detail data display primitives.',
  },
  {
    id: 'components/navbar',
    sourceRel: 'components/navbar',
    description: 'Resizable public-page navbar with scroll and hover motion.',
  },
  {
    id: 'components/storage',
    sourceRel: 'components/storage',
    description: 'Storage management, file browser, drive list, and dropzone UI.',
  },
  {
    id: 'hooks',
    sourceRel: 'hooks',
    description: 'Generic React hooks provided by Zero.',
  },
  {
    id: 'modals',
    sourceRel: 'modals',
    description: 'Modal manager, confirm modal, and hold-to-confirm button.',
  },
];

/** Return the static targets that can be listed without touching the filesystem. */
export function listStaticAddableTargets(): AddableTarget[] {
  return [...STATIC_TARGETS];
}

/**
 * Resolve a requested `zero add` item to a source-copy target.
 *
 * Supports static registry ids plus `components/ui/<name>` for individual UI
 * primitives. Throws for unknown items so the CLI can print the supported list.
 */
export function resolveAddableTarget(item: string, sourceRoot: string): AddableTarget {
  const normalized = item.replace(/^\/+|\/+$/g, '');
  const staticTarget = STATIC_TARGETS.find((target) => target.id === normalized);
  if (staticTarget) return staticTarget;

  if (normalized.startsWith('components/ui/')) {
    const name = normalized.slice('components/ui/'.length);
    if (!name || name.includes('/') || name.startsWith('.')) throw unknownAddable(item);

    const sourceRel = `components/ui/${name}.tsx`;
    if (!existsSync(join(sourceRoot, sourceRel))) throw unknownAddable(item);

    return {
      id: normalized,
      sourceRel,
      description: `UI primitive: ${name}.`,
    };
  }

  throw unknownAddable(item);
}

function unknownAddable(item: string): Error {
  const staticIds = STATIC_TARGETS.map((target) => target.id).join(', ');
  return new Error(`[zero add] Unknown item "${item}". Supported: ${staticIds}, components/ui/<name>`);
}
