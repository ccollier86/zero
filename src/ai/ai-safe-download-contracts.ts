/** Shared contracts for Zero's bounded AI asset download transport. */

export interface AISafeDownloadResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface AISafeDownloadFetchInit extends RequestInit {
  readonly tls?: { readonly serverName?: string };
}

export type AISafeDownloadFetch = (
  input: string | URL | Request,
  init?: AISafeDownloadFetchInit,
) => Promise<Response>;

export interface AISafeDownloadTransportOptions {
  readonly maxBytes: number;
  readonly abortSignal?: AbortSignal;
  /** Test seam. Production callers use Bun's DNS resolver. */
  readonly lookup?: (
    hostname: string,
    port: number,
  ) => Promise<readonly AISafeDownloadResolvedAddress[]>;
  /** Test seam. Production callers use Bun's fetch implementation. */
  readonly fetch?: AISafeDownloadFetch;
}

/** SDK-compatible single-asset downloader used by transcription and video. */
export type AISafeSingleDownload = (options: {
  readonly url: URL;
  readonly abortSignal?: AbortSignal;
}) => Promise<{ data: Uint8Array; mediaType: string | undefined }>;
