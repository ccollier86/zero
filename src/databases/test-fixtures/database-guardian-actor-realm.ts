/** Realm fixture with a declarative Guardian membership foreign key. */

import { defineTable, field } from '../../schema';
import { defineDatabaseRealm } from '../database-realm';

const tasks = defineTable('tasks', {
  assignee_membership_id: field.guardianMembership(),
  title: field.text(),
}, { pk: 'task_id' });

export const databaseGuardianActorFixtureRealm = defineDatabaseRealm({
  name: 'database-guardian-actor-fixture',
  version: '1',
  tables: { tasks: tasks.serverTable },
});
