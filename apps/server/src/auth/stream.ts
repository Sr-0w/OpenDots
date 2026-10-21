import { onSessionRevoked, sessionAccount, sessionExpiresAt } from './store.ts';

/** Detach this browser on logout/expiry without stopping the companion's turn. */
export async function sessionStream(source: ReadableStream<Uint8Array>, token: string) {
  const expires = await sessionExpiresAt(token);
  const reader = source.getReader();
  let open = true, off = () => {}, expiry: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (!open) return;
        open = false; off(); if (expiry) clearTimeout(expiry);
        void reader.cancel().catch(() => {});
        try { controller.close(); } catch { /* already cancelled by browser */ }
      };
      off = onSessionRevoked(token, stop);
      expiry = setTimeout(stop, Math.min(2 ** 31 - 1, Math.max(0, expires - Date.now())));
      void (async () => {
        try {
          if (!await sessionAccount(token)) return stop();
          while (open) {
            const part = await reader.read();
            if (!open) break;
            if (part.done) return stop();
            controller.enqueue(part.value);
          }
        } catch (error) { if (open) { open = false; off(); if (expiry) clearTimeout(expiry); controller.error(error); } }
      })();
    },
    cancel() { open = false; off(); if (expiry) clearTimeout(expiry); void reader.cancel().catch(() => {}); },
  });
}
