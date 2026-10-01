/** Isomorphic task authorization contract shared by config, UI, and tests. */

export const TASK_READ_PERMISSIONS = ['tasks:read:any', 'tasks:read'] as const;

export const TASK_PERMISSION_REGISTRY = Object.freeze({
  'tasks:read': {
    scope: 'tenant' as const,
    label: 'Read assigned tasks',
    description: 'Read tasks attributed to the active workspace membership.',
  },
  'tasks:read:any': {
    scope: 'tenant' as const,
    label: 'Read every task',
    description: 'Read every task in the active workspace database.',
  },
  'tasks:create': {
    scope: 'tenant' as const,
    label: 'Create assigned tasks',
    description: 'Create tasks stamped to the active Guardian user and membership.',
  },
  'tasks:update:own': {
    scope: 'tenant' as const,
    label: 'Update assigned tasks',
    description: 'Update tasks owned by the active Guardian user and membership.',
  },
  'tasks:manage': {
    scope: 'tenant' as const,
    label: 'Manage every task',
    description: 'Read, update, and remove every task in the active workspace database.',
  },
});

export type TaskPermission = keyof typeof TASK_PERMISSION_REGISTRY;

export const TASK_ROLE_REGISTRY = Object.freeze({
  viewer: {
    label: 'Task viewer',
    description: 'Read every task in the active workspace without changing it.',
    permissions: ['tasks:read', 'tasks:read:any'] as const,
  },
  editor: {
    label: 'Task contributor',
    description: 'Create, read, and move only tasks owned by the current actor.',
    permissions: ['tasks:read', 'tasks:create', 'tasks:update:own'] as const,
  },
  manager: {
    label: 'Task manager',
    description: 'Read, create, move, and remove every task in the active workspace.',
    permissions: [
      'tasks:read',
      'tasks:read:any',
      'tasks:create',
      'tasks:update:own',
      'tasks:manage',
    ] as const,
  },
});

export type TaskRole = keyof typeof TASK_ROLE_REGISTRY;

export const TASK_CAPABILITY_ORDER = Object.freeze([
  'tasks:read',
  'tasks:read:any',
  'tasks:create',
  'tasks:update:own',
  'tasks:manage',
] as const satisfies readonly TaskPermission[]);

/** Pure projection used by the proof center and its contract tests. */
export function taskRoleAllows(role: TaskRole, permission: TaskPermission): boolean {
  return (TASK_ROLE_REGISTRY[role].permissions as readonly string[]).includes(permission);
}
