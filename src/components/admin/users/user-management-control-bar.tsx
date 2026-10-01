'use client';

import * as React from 'react';
import { Building2, Users } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '../../ui/select';
import { cn } from '../../../lib/utils';

export type PlatformManagementView = 'people' | 'workspaces';
export type PlatformPeopleScope = 'administration' | 'identities';

/** Compact context controls for the adaptive administration workspace. */
export function UserManagementControlBar({
  view,
  peopleScope,
  administrationName,
  workspaceSingular,
  workspacePlural,
  showWorkspaces = true,
  showIdentities = true,
  onViewChange,
  onPeopleScopeChange,
  className,
}: {
  view: PlatformManagementView;
  peopleScope: PlatformPeopleScope;
  administrationName: string;
  workspaceSingular: string;
  workspacePlural: string;
  /** Hide customer workspace navigation until live application authority permits it. */
  showWorkspaces?: boolean;
  /** Hide the global identity scope until live application authority permits it. */
  showIdentities?: boolean;
  onViewChange(view: PlatformManagementView): void;
  onPeopleScopeChange(scope: PlatformPeopleScope): void;
  className?: string;
}) {
  const peopleScopeLabel = peopleScope === 'administration'
    ? administrationName
    : 'All platform identities';
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-background p-2 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      aria-label="Management view controls"
    >
      <div className="flex items-center gap-1 rounded-md bg-muted p-1" role="group" aria-label="Manage">
        <ViewButton
          active={view === 'people'}
          icon={<Users className="size-4" />}
          label="People"
          onClick={() => onViewChange('people')}
        />
        {showWorkspaces && (
          <ViewButton
            active={view === 'workspaces'}
            icon={<Building2 className="size-4" />}
            label={capitalize(workspacePlural)}
            onClick={() => onViewChange('workspaces')}
          />
        )}
      </div>

      {view === 'people' && showIdentities && (
        <Select
          value={peopleScope}
          onValueChange={(value) => onPeopleScopeChange(value as PlatformPeopleScope)}
        >
          <SelectTrigger className="h-8 w-full text-sm sm:w-[17rem]" aria-label="People scope">
            <span className="truncate">{peopleScopeLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="administration">{administrationName}</SelectItem>
            <SelectItem value="identities">All platform identities</SelectItem>
          </SelectContent>
        </Select>
      )}

      {view === 'people' && !showIdentities && (
        <p className="truncate px-1 text-xs text-muted-foreground">
          {administrationName}
        </p>
      )}

      {view === 'workspaces' && (
        <p className="px-1 text-xs text-muted-foreground">
          Select a {workspaceSingular} to inspect its members and access.
        </p>
      )}
    </div>
  );
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      className={cn('h-7 gap-1.5 px-2.5', active && 'bg-background shadow-sm')}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
