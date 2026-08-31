/** Strict application/x-www-form-urlencoded parser for OAuth endpoints. */

import { NativeTokenError } from './native-token-error';

export async function readNativeForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type')
    ?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    throw new NativeTokenError('invalid_request', 'Form-encoded request body required.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 16_384) {
    throw new NativeTokenError('invalid_request', 'OAuth request body is too large.');
  }
  const body = await request.text();
  if (body.length > 16_384) {
    throw new NativeTokenError('invalid_request', 'OAuth request body is too large.');
  }
  return new URLSearchParams(body);
}

export function requiredFormField(form: URLSearchParams, name: string): string {
  const values = form.getAll(name);
  if (values.length !== 1 || !values[0] || values[0] !== values[0].trim()
    || values[0].length > 4_096) {
    throw new NativeTokenError('invalid_request', `${name} is required exactly once.`);
  }
  return values[0];
}

export function optionalFormField(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  if (values.length > 1) {
    throw new NativeTokenError('invalid_request', `${name} must appear at most once.`);
  }
  return values[0] || undefined;
}

export function rejectClientSecret(form: URLSearchParams): void {
  if (form.has('client_secret') || form.has('client_assertion')) {
    throw new NativeTokenError('invalid_client', 'Native public clients do not use secrets.');
  }
}
