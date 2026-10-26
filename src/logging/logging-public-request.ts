/** Framework-private public-route classification. Only a selected route's local transform may classify its exact Request object. */
const publicRequests = new WeakSet<Request>();
/** Public publication projections are not protected work, even when the browser also carries an unrelated signed-in session. */
export function markPublicLoggingRequest(request: Request): void { publicRequests.add(request); }
/** No URL prefix, header, body field or cookie can claim this classification. */
export function isPublicLoggingRequest(request: Request): boolean { return publicRequests.has(request); }
