import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/settings.ts', () => ({ getSetting: async () => 'http://ollama.test', getOpenRouterKey: async () => null }));
import { requireDesktopVision } from '../src/models/gateway.ts';

afterEach(() => vi.unstubAllGlobals());
it('refuse le bureau pour un modèle texte et accepte une entrée image annoncée par OpenRouter', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
    { id: 'text', architecture: { input_modalities: ['text'] } },
    { id: 'vision', architecture: { input_modalities: ['text', 'image'] } },
  ] })));
  await expect(requireDesktopVision({ provider: 'openrouter', model: 'text' })).rejects.toThrow('modèle vision');
  await expect(requireDesktopVision({ provider: 'openrouter', model: 'vision' })).resolves.toBeUndefined();
  await expect(requireDesktopVision({ provider: 'openrouter', model: 'unknown' })).rejects.toThrow('modèle vision');
});
it('vérifie les capacités locales d’Ollama, sans supposer que tous les modèles voient les images', async () => {
  const fetcher = vi.fn(async () => Response.json({ capabilities: ['completion'] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(requireDesktopVision({ provider: 'ollama', model: 'text' })).rejects.toThrow('vision');
  fetcher.mockImplementation(async () => Response.json({ capabilities: ['completion', 'vision'] }));
  await expect(requireDesktopVision({ provider: 'ollama', model: 'vision' })).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenLastCalledWith('http://ollama.test/api/show', expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'vision' }) }));
});
