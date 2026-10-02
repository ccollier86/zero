import { AuthError } from '../../../auth/types';

/**
 * Compile-time proof that every public service member is deliberately exposed
 * or denied by a request facade. A new domain-service member therefore makes
 * the facade fail typechecking until its request policy is reviewed.
 */
export type CompleteServiceMemberInventory<
  TService extends object,
  TAllowed extends PropertyKey,
  TDenied extends PropertyKey,
> = [Exclude<keyof TService, TAllowed | TDenied>] extends [never]
  ? [Exclude<TAllowed | TDenied, keyof TService>] extends [never]
    ? [Extract<TAllowed, TDenied>] extends [never]
      ? true
      : never
    : never
  : never;

/** Create a fail-closed facade exposing only the supplied request-safe methods. */
export function restrictedServiceProxy<
  TService extends object,
  TMethods extends object,
>(
  service: TService,
  methods: TMethods,
  denied: ReadonlySet<string>,
  label: string,
): TMethods {
  return new Proxy(service, {
    get(target, property) {
      if (typeof property === 'string' && Object.hasOwn(methods, property)) {
        return Reflect.get(methods, property, methods);
      }
      if (typeof property === 'string') {
        const kind = denied.has(property) ? 'method' : 'member';
        throw new Error(
          `[server-services] ${label} ${kind} "${property}" is not available through the request-scoped facade; use zero.unsafe for deliberate privileged access.`,
        );
      }
      return Reflect.get(target, property, target);
    },
    has(_target, property) {
      return typeof property === 'string' && Object.hasOwn(methods, property);
    },
    ownKeys() {
      return Reflect.ownKeys(methods);
    },
    getOwnPropertyDescriptor(_target, property) {
      return typeof property === 'string' && Object.hasOwn(methods, property)
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  }) as TService & TMethods;
}

export function forbidden(message: string): AuthError {
  return new AuthError(message, 'FORBIDDEN', 403);
}

export function notFound(message: string): AuthError {
  return new AuthError(message, 'NOT_FOUND', 404);
}
