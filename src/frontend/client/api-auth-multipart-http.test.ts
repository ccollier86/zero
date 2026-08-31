/** Black-box coverage for multipart replay through the browser fetch boundary. */

import { afterEach, describe, expect, it } from 'bun:test';
import { createApi } from './api';
import { AuthClient } from './auth-client';

const REFRESH_TOKEN_KEY = '__platform_refresh_token';

afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(REFRESH_TOKEN_KEY);
});

describe('authenticated Eden multipart HTTP transport', () => {
  it('serializes and parses the file again with the refreshed bearer', async () => {
    const uploads: Array<{ authorization: string | null; contentType: string; file: File }> = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/auth/login') return loginResponse();
        if (pathname === '/auth/refresh') {
          return Response.json({ accessToken: 'access-2', refreshToken: 'refresh-2' });
        }
        if (pathname !== '/api/staff/document-tools/pdf-text') {
          return new Response('Not found', { status: 404 });
        }

        const body = await request.formData();
        const file = body.get('file');
        if (!(file instanceof File)) return new Response('Missing file', { status: 400 });
        uploads.push({
          authorization: request.headers.get('authorization'),
          contentType: request.headers.get('content-type') ?? '',
          file,
        });
        return uploads.length === 1
          ? Response.json({ error: 'Unauthorized' }, { status: 401 })
          : Response.json({ text: await file.text() });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const auth = new AuthClient(baseUrl);
      await auth.login('ada', 'password');

      const result = await createApi(baseUrl, auth).api.staff
        ['document-tools']['pdf-text'].post({
          file: new File(['%PDF-1.7'], 'HIV.pdf', { type: 'application/pdf' }),
        });

      expect(result.status).toBe(200);
      expect(uploads.map((upload) => upload.authorization)).toEqual([
        'Bearer access-1',
        'Bearer access-2',
      ]);
      for (const upload of uploads) {
        expect(upload.contentType).toStartWith('multipart/form-data; boundary=');
        expect(upload.file.name).toBe('HIV.pdf');
        expect(upload.file.type).toBe('application/pdf');
        expect(await upload.file.text()).toBe('%PDF-1.7');
      }
    } finally {
      await server.stop(true);
    }
  });
});

function loginResponse(): Response {
  return Response.json({
    user: {
      userId: 'u_1',
      username: 'ada',
      email: 'ada@example.com',
      firstName: null,
      lastName: null,
      role: 'user',
      status: 'active',
      passwordChangeRequired: false,
      emailVerifiedAt: 1,
      emailVerificationRequired: false,
      mfaRequired: false,
      properties: {},
      createdAt: 1,
      updatedAt: null,
    },
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  });
}
