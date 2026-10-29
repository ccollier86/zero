export const config = { auth: false } as const;
export function GET() {
  return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>', {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' },
  });
}
