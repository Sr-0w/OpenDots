/** Consume a stream without letting a slow tool/output formatter hold Stop open. */
export async function* abortableChunks<T>(source: ReadableStream<T>, signal: AbortSignal): AsyncGenerator<T> {
  const reader = source.getReader();
  try {
    while (!signal.aborted) {
      const next = await new Promise<ReadableStreamReadResult<T>>((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) { signal.removeEventListener('abort', aborted); reject(signal.reason); return; }
        reader.read().then((value) => { signal.removeEventListener('abort', aborted); resolve(value); }, (error) => { signal.removeEventListener('abort', aborted); reject(error); });
      });
      if (next.done) break;
      yield next.value;
    }
  } finally {
    if (signal.aborted) void reader.cancel(signal.reason).catch(() => {});
    else reader.releaseLock();
  }
}
