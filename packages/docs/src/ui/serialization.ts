/** Inert application/json text must not be able to close its own script element. */
export function serializeDocsProps(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}
