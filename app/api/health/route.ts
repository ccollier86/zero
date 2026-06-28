import type { LoaderContext } from '../../../src/frontend/router/types';

export function GET(_ctx: LoaderContext): Response {
  return Response.json({
    status: 'ok',
    timestamp: Date.now(),
  });
}
