/** Bounded native HTTP cancellation regression. Deliberately imports no Zero, auth, configuration or persistence. */
export {};
const requests = 2_000;
const concurrency = 20;
let completed = 0, aborted = 0, producerCancellations = 0;
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch() {
    let cancelled = false;
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        await Bun.sleep(0);
        if (cancelled) return;
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
      cancel() { cancelled = true; producerCancellations++; },
    }), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
  },
});
const deadline = setTimeout(() => { process.stderr.write('Native HTTP cancellation exceeded 15 seconds.\n'); process.exit(1); }, 15_000);
try {
  await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
    for (let index = worker; index < requests; index += concurrency) {
      const controller = new AbortController();
      // Keep some complete requests while aborting others on both sides of a pull.
      const timer = index % 5 === 0 ? undefined : setTimeout(() => controller.abort(), index % 4);
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal });
        const body = await response.arrayBuffer();
        if (body.byteLength !== 8) throw new Error('Unexpected native response size.');
        completed++;
      } catch (cause) {
        if (!controller.signal.aborted) throw cause;
        aborted++;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }
  }));
  for (let elapsed = 0; server.pendingRequests && elapsed < 2_000; elapsed += 5) await Bun.sleep(5);
  if (server.pendingRequests || completed + aborted !== requests || !completed || !aborted) throw new Error('Native cancellation work did not settle.');
  process.stdout.write(`${JSON.stringify({ runtime: Bun.version, requests, completed, aborted, producerCancellations, pending: server.pendingRequests })}\n`);
} finally {
  await server.stop(true);
  clearTimeout(deadline);
}
