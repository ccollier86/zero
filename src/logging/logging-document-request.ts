/** Response negotiation only; these client headers never grant publicness or authorization. */
export function isLoggingDocumentRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const destination = request.headers.get('sec-fetch-dest'), mode = request.headers.get('sec-fetch-mode');
  if (destination !== null && destination !== 'document' && destination !== 'iframe') return false;
  if (mode !== null && mode !== 'navigate') return false;
  if (destination === 'document' || destination === 'iframe') return true;
  return (request.headers.get('accept') ?? '').split(',').some(item => {
    const [type, ...parameters] = item.trim().toLowerCase().split(';');
    if (type !== 'text/html') return false;
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    return quality === undefined || Number(quality.trim().slice(2)) > 0;
  });
}
