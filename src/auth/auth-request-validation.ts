/** Privacy-safe observability for rejected auth HTTP contracts. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { getSafeRequestPath } from '../observability/safe-request-path';

export function emitAuthRequestValidationRejected(request: Request): void {
  emitPlatformCode(OBS_CODES.AUTH_REQUEST_VALIDATION_REJECTED, {
    metadata: {
      method: request.method,
      path: getSafeRequestPath(request),
      status: 422,
    },
  });
}
