/** Source-imported Fabric realm; host durable handlers call an ordinary app dispatcher. */
import {
  defineDatabaseAutomations, defineDatabaseFunction, defineDatabaseTrigger,
  type DatabaseTriggerFunctionInput,
} from '../../../../database-automations';
import { defineDatabaseRealm, type DatabaseAutomationExecutionServerServices } from '../../../server';
import { invokeAppFunction, type FixtureFunctionArguments } from './dispatcher';

export const appFunctionTables = {
  function_jobs: {
    id: 'text primary key', function_name: 'text not null', function_version: 'integer not null',
    parameters_json: 'text not null',
  },
  published_documents: {
    id: 'text primary key', title: 'text not null', labels: 'text not null',
    score: 'integer not null', actual_tenant_id: 'text not null',
  },
};

const dispatch = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices
>({
  name: 'jobs.invoke-app-function', version: 1, mode: 'durable',
  async handler({ input, invocation, zero, signal }) {
    const row = input.change.row;
    if (!row || typeof row.function_name !== 'string'
      || typeof row.function_version !== 'number' || typeof row.parameters_json !== 'string') {
      throw new Error('The captured function job is invalid.');
    }
    const parameters = JSON.parse(row.parameters_json) as FixtureFunctionArguments;
    await invokeAppFunction(row.function_name, row.function_version, parameters, {
      zero, signal, invocation,
    });
  },
});

export const appFunctionRealm = defineDatabaseRealm({
  name: 'automation-app-functions-proof', version: '1', tables: appFunctionTables,
  automations: defineDatabaseAutomations({
    functions: [dispatch], triggers: [defineDatabaseTrigger({
      name: 'jobs.created', version: 1, table: 'function_jobs', after: { insert: true }, run: dispatch,
    })],
  }),
  queries: {
    'proof.delivery': ({ database }, input) => database.query(`
      SELECT status, attempt_count, invocation_id, function_identity, source_row_id
      FROM _zero_database_automation_outbox WHERE source_row_id = ?
    `).get(String(input)) as {
      status: string; attempt_count: number; invocation_id: string;
      function_identity: string; source_row_id: string;
    } | null,
  },
});
