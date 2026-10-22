import type { OpenDotsUIMessage } from '../conversations/repo.ts';
import type { UIMessageChunk } from 'ai';

export const INTERRUPTED = 'Interrompu par l’utilisateur.';
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
export function reportUnhandledRejection(error: unknown) {
  if (isAbortError(error)) { console.debug('[abort] Opération annulée.'); return; }
  console.error('[unhandledRejection]', error);
}
/** Preserve partial text and settle tool inputs even if the SDK ends mid-tool. */
export function interruptedMessage(message: OpenDotsUIMessage | null, chunks: UIMessageChunk[], id: string): OpenDotsUIMessage {
  const parts: any[] = message ? structuredClone(message.parts) : [];
  for (const chunk of chunks) {
    if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') {
      const existing = parts.find((p) => p.toolCallId === chunk.toolCallId);
      if (!existing) parts.push({ type: `tool-${chunk.toolName}`, toolCallId: chunk.toolCallId, state: 'input-available', input: chunk.type === 'tool-input-available' ? chunk.input : {} });
      else if (chunk.type === 'tool-input-available') existing.input = chunk.input;
    }
    if (!message && chunk.type === 'text-delta') {
      let text = parts.find((p) => p.type === 'text');
      if (!text) { text = { type: 'text', text: '' }; parts.push(text); }
      text.text += chunk.delta;
    }
    if (!message && chunk.type === 'tool-output-available') {
      const part = parts.find((p) => p.toolCallId === chunk.toolCallId);
      if (part) Object.assign(part, { state: 'output-available', output: chunk.output });
    }
  }
  for (const part of parts) {
    if (part.type?.startsWith('tool-') && ['input-streaming', 'input-available'].includes(part.state)) Object.assign(part, { state: 'output-error', errorText: INTERRUPTED });
  }
  return { ...message, id, role: 'assistant', parts };
}
