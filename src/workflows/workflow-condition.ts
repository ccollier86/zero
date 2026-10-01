/** Compile and evaluate the trusted, app-authored workflow condition DSL. */

export type WorkflowCondition = (input: unknown) => boolean;

/**
 * Conditions are application configuration and therefore share the trust
 * boundary of server code. Compile them during registration so syntax errors
 * fail startup rather than leaving a durable instance stranded at runtime.
 */
export function compileWorkflowCondition(condition: string): WorkflowCondition {
  const evaluate = new Function('input', `return Boolean(${condition})`) as WorkflowCondition;
  return (input: unknown) => Boolean(evaluate(input));
}
