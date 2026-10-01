'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@zero/framework/components/ui/card';
import { CodeBlock } from '@zero/framework/react';

export const API_KEY_EXAMPLES = Object.freeze([
  {
    id: 'list',
    label: 'List tasks',
    filename: 'list-tasks.sh',
    language: 'bash',
    code: `(
restore_tty() { stty echo; }
trap restore_tty EXIT HUP INT TERM
printf 'Guardian API key: ' >&2
stty -echo
IFS= read -r guardian_api_key
stty echo
printf '\\n' >&2
trap - EXIT HUP INT TERM

printf 'header = "Authorization: Bearer %s"\\n' "$guardian_api_key" \\
  | curl -q --config - --fail-with-body \\
      "\${ZERO_URL:-http://localhost:3100}/api/resources/tasks"
request_status=$?

unset guardian_api_key
unset -f restore_tty
exit "$request_status"
)`,
  },
  {
    id: 'create',
    label: 'Create task',
    filename: 'create-task.sh',
    language: 'bash',
    code: `(
restore_tty() { stty echo; }
trap restore_tty EXIT HUP INT TERM
printf 'Guardian API key: ' >&2
stty -echo
IFS= read -r guardian_api_key
stty echo
printf '\\n' >&2
trap - EXIT HUP INT TERM

printf 'header = "Authorization: Bearer %s"\\n' "$guardian_api_key" \\
  | curl -q --config - --fail-with-body \\
      "\${ZERO_URL:-http://localhost:3100}/api/resources/tasks" \\
      --request POST \\
      --header 'Content-Type: application/json' \\
      --header 'Idempotency-Key: proof-api-task-v1' \\
      --data '{"task_id":"api-proof-task","title":"Created through Guardian","status":"open"}'
request_status=$?

unset guardian_api_key
unset -f restore_tty
exit "$request_status"
)`,
  },
] as const);

/** Safe command examples for exercising user-bound Resource authentication. */
export function ApiKeyUsageGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>Exercise the key against the task Resource</h2></CardTitle>
        <CardDescription>
          Run one of these commands locally and paste the once-revealed secret into the hidden
          prompt. The unexported shell variable is piped to curl through standard input so the
          key is not placed in the command arguments. The server resolves its current user,
          workspace, role, and permissions on every request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {API_KEY_EXAMPLES.map((example) => {
          const headingId = `api-key-example-${example.id}`;
          return (
            <section key={example.id} className="space-y-2" aria-labelledby={headingId}>
              <h3 id={headingId} className="text-sm font-medium">{example.label}</h3>
              <CodeBlock
                files={[example]}
                defaultFileId={example.id}
                showLineNumbers={false}
              />
            </section>
          );
        })}
        <p className="text-xs leading-5 text-muted-foreground">
          The create timestamp and Guardian identity references are server-owned. API keys do
          not authenticate ReactiveDB Sync or Guardian management routes. Use Bearer keys only
          over HTTPS outside this localhost proof.
        </p>
      </CardContent>
    </Card>
  );
}
