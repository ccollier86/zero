/** Browser-safe private media library contract. Storage paths and lease secrets never leave the server. */
import type { BlogMutationOptions, BlogPage } from './content-types';
export type BlogMediaKind = 'image' | 'video' | 'audio';
export interface BlogMediaInput { kind: BlogMediaKind; fileName: string; mimeType: string }
export interface BlogMediaAsset extends BlogMediaInput {
  id: string; siteId: string; state: 'allocated' | 'ready' | 'removing' | 'removed';
  createdAt: number; expiresAt: number; sizeBytes: number | null; width: number | null; height: number | null;
  /** Authenticated preview, not a public Storage object or permanent signed URL. */
  previewPath: string | null;
}
export interface BlogMediaApi {
  list(query?: { kind?: BlogMediaKind; limit?: number; offset?: number }, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogMediaAsset>>;
  get(id: string, options?: { signal?: AbortSignal }): Promise<BlogMediaAsset>;
  allocate(input: BlogMediaInput, options: BlogMutationOptions): Promise<BlogMediaAsset>;
  /** Immutable first upload wins. Retry an interrupted allocation with the same asset/request identities. */
  upload(id: string, body: Blob | Uint8Array | ReadableStream<Uint8Array>, options: BlogMutationOptions): Promise<BlogMediaAsset>;
  remove(id: string, options: BlogMutationOptions): Promise<{ removed: true }>;
}
/** Browser-only binary projection; authenticated images are read through the same SDK instead of leaking private URLs into img tags. */
export interface BlogBrowserMediaApi extends BlogMediaApi {
  imagePreview(id: string, options?: { signal?: AbortSignal }): Promise<Blob>;
}
