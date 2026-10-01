export type TaskStatus = 'open' | 'complete';

/** Browser-visible shape of the physically isolated task Resource. */
export interface TaskRow extends Record<string, unknown> {
  task_id: string;
  title: string;
  status: TaskStatus;
  created_at: number;
  created_by_user_id: string;
  assigned_membership_id: string;
}

export interface TaskColumn {
  status: TaskStatus;
  label: string;
  accent: string;
}

export { TASK_READ_PERMISSIONS } from '../../shared/task-access';

export const TASK_COLUMNS: TaskColumn[] = [
  { status: 'open', label: 'Open', accent: 'bg-primary' },
  { status: 'complete', label: 'Complete', accent: 'bg-success' },
];

export function isTaskStatus(value: string): value is TaskStatus {
  return value === 'open' || value === 'complete';
}
