import { jsonSchema } from 'ai';
import { z } from 'zod';
import { desktopActionSchema } from './desktop.ts';

// Publish only primitive fields: nested oneOf/action.action is unreliable on
// several OpenRouter endpoints. Runtime normalization remains strict below.
const variants = (z.toJSONSchema(desktopActionSchema) as any).oneOf as any[];
const properties = Object.assign({}, ...variants.map(v => v.properties), {
  action: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'move'] },
  reason: { type: 'string', minLength: 1, maxLength: 300 },
});
export const computerInputSchema = jsonSchema<Record<string, unknown>>({ type: 'object', properties, required: ['action', 'reason'], additionalProperties: false }, {
  // Let execute return a useful invalid_input result rather than aborting the
  // tool call. This also accepts old persisted calls and stringified objects.
  validate: async value => ({ success: true, value: value as Record<string, unknown> }),
});
export function normalizeComputerInput(input: unknown) {
  try {
    const raw = z.record(z.string(), z.unknown()).parse(input);
    const reason = z.string().min(1).max(300).parse(raw.reason);
    let action: unknown = raw.action;
    if (typeof action === 'string' && action.trim().startsWith('{')) action = JSON.parse(action);
    else if (typeof action === 'string') { const { reason: _, ...flat } = raw; action = flat; }
    return { ok: true as const, action: desktopActionSchema.parse(action), reason };
  } catch (error) {
    return { ok: false as const, status: 'invalid_input', error: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Objet action JSON invalide.', expected: { action: 'click', x: 617, y: 769, reason: 'Cliquer sur la cible observée' } };
  }
}
