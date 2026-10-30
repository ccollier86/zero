/** One native investigation table definition, shared by the workspace and drill-downs. */
import { defineSchema, field } from '../../schema';
export const loggingTableSchema = defineSchema({ time: field.text({ label: 'When' }), actor: field.text({ label: 'Who' }), action: field.text({ label: 'Activity' }), target: field.text({ label: 'Item' }), details: field.text({ label: 'Details' }), outcome: field.text({ label: 'Result' }), evidence: field.text({ label: 'Recorded by' }), inspect: field.text({ label: 'Inspect' }) });
