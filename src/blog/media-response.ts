/** Native media delivery headers. Content was admitted through the published/private manifest before opening this stream. */
import type { BlogMediaDownload } from './media-service';

/** Never cache a withdrawable publication or expose a raw private Storage URL. */
export function blogMediaResponse(value: BlogMediaDownload): Response {
  return new Response(value.stream, { status: value.partial ? 206 : 200, headers: {
    'Content-Type': value.asset.mimeType, 'Content-Length': String(value.end - value.start + 1), 'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...(value.partial ? { 'Content-Range': `bytes ${value.start}-${value.end}/${value.asset.sizeBytes}` } : {}),
  } });
}
