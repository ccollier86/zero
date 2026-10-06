/** Public permission-checked endpoint testing both actor read modes and filtered cursors. */
import { defineEndpoint, type DatabaseFindFilter } from '@zero/framework/server';

export default defineEndpoint({
  method: 'GET', path: '/proof/arrays',
  auth: { user: 'required', tenant: 'required', permission: 'proof:read' },
  async handler({ zero }) {
    if (!zero.data) throw new Error('Bound data capability unavailable.');
    const filter = {
      type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['A'],
    } as const satisfies DatabaseFindFilter;
    const input = { filters: [filter], order: [{ field: 'id', direction: 'asc' }], limit: 20 } as const;
    const reader = await zero.data.find('tasks', input);
    const writer = await zero.data.find('tasks', input, { consistency: { mode: 'strong' } });
    const first = await zero.data.list('tasks', { filters: [filter], limit: 1 });
    const next = first.value.nextCursor
      ? await zero.data.list('tasks', { filters: [filter], limit: 1, after: first.value.nextCursor })
      : null;
    return { reader: reader.value, writer: writer.value, first: first.value, next: next?.value };
  },
});
