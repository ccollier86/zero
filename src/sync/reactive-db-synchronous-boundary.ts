/** Fail closed while inspecting callbacks that must stay synchronous. */

export function isReactiveDBPromiseLike(
  value: unknown,
): value is PromiseLike<unknown> {
  if (value === null
    || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  try {
    return typeof (value as { then?: unknown }).then === 'function';
  } catch (cause) {
    throw new Error(
      'ReactiveDB synchronous callback thenable inspection failed',
      { cause },
    );
  }
}
