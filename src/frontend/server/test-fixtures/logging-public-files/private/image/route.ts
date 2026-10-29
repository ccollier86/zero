export const config = { auth: false } as const;
export function GET() { return new Response('PRIVATE_FILE_ART'); }
