/** Shared cache policy for auth responses that vary by live identity/scope. */

interface AuthResponseSet {
  headers: Record<string, string | number>;
}

/** Prevent browsers and intermediaries from retaining sensitive auth output. */
export function applyAuthPrivateNoStore(set: AuthResponseSet): void {
  set.headers['Cache-Control'] = 'private, no-store';
  set.headers.Pragma = 'no-cache';
}
