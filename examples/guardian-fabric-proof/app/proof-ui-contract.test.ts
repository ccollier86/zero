import { describe, expect, test } from 'bun:test';

import { activeTenantActions } from './components/dashboard-shell';
import { TASK_COLUMNS, TASK_READ_PERMISSIONS } from './tasks/task-types';

describe('Guardian + Fabric proof UI contract', () => {
  test('admits either declared task-read permission before mounting Sync', () => {
    expect(TASK_READ_PERMISSIONS).toEqual(['tasks:read:any', 'tasks:read']);
  });

  test('routes the workspace switcher action to the active scope management page', () => {
    expect(activeTenantActions('administration')).toEqual([{
      id: 'platform-operations',
      label: 'Platform operations',
      icon: 'lock',
      href: '/platform',
    }]);
    expect(activeTenantActions('organization')).toEqual([{
      id: 'workspace-settings',
      label: 'Workspace settings',
      icon: 'settings',
      href: '/organization',
    }]);
  });

  test('uses the framework semantic success token for completed work', () => {
    expect(TASK_COLUMNS.find((column) => column.status === 'complete')?.accent)
      .toBe('bg-success');
  });
});
