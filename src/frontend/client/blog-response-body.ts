/** Binary endpoints still return bounded, abortable JSON acknowledgments; transport errors never require buffering arbitrary bodies. */
export async function readBlogBinaryJson(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The blog acknowledgment is missing.');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 64 * 1024) throw new Error('The blog acknowledgment exceeds its admitted size.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
