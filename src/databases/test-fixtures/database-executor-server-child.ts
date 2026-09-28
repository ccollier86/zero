/** End-to-end fixture for the production process IPC adapter. */

import { DatabaseError } from '../database-error';
import { SubprocessDatabaseServer } from '../subprocess-database-server';

const server = new SubprocessDatabaseServer({
  role: 'database-server-e2e',
  slot: 9,
  handle(request) {
    if (request.operation === 'echo') return request.payload;
    if (request.operation === 'fail') {
      throw new DatabaseError(
        'DATABASE_CONFLICT',
        'Fixture operation conflict.',
        { retryable: true, outcome: 'not-committed' },
      );
    }
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      'Fixture operation is unsupported.',
    );
  },
});

try {
  await server.run();
} catch {
  process.exitCode = 70;
}
