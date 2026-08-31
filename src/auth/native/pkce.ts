const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

let encoder: TextEncoder | undefined;

export function isValidPkceVerifier(value: string): boolean {
  return PKCE_VERIFIER.test(value);
}

export function isValidPkceS256Challenge(value: string): boolean {
  return PKCE_S256_CHALLENGE.test(value);
}

export async function derivePkceS256Challenge(verifier: string): Promise<string> {
  if (!isValidPkceVerifier(verifier)) {
    throw new Error('[native-auth] Invalid PKCE code verifier.');
  }

  encoder ??= new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

export async function verifyPkceS256(
  verifier: string,
  expectedChallenge: string
): Promise<boolean> {
  if (!isValidPkceVerifier(verifier)) return false;
  if (!isValidPkceS256Challenge(expectedChallenge)) return false;
  const actual = await derivePkceS256Challenge(verifier);
  return constantTimeEqual(actual, expectedChallenge);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
