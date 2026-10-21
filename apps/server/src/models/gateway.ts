import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ModelConfig } from '@opendots/shared';
import { getOpenRouterKey, getSetting } from '../settings.ts';

/**
 * Model Gateway : seule couche qui connaît les fournisseurs. Le reste de
 * l'application manipule uniquement des ModelConfig.
 */
export interface ResolvedModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, any>>;
  label: string;
}

export class ModelUnavailableError extends Error {}

export async function resolveModel(cfg: ModelConfig): Promise<ResolvedModel> {
  if (cfg.provider === 'ollama') {
    const url = (await getSetting('ollama.url')) ?? 'http://127.0.0.1:11434';
    const ollama = createOpenAICompatible({ name: 'ollama', baseURL: `${url.replace(/\/$/, '')}/v1` });
    return {
      model: ollama.chatModel(cfg.model),
      providerOptions: cfg.reasoning ? { ollama: { reasoningEffort: cfg.reasoning } } : {},
      label: `ollama/${cfg.model}`,
    };
  }
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new ModelUnavailableError("La clé OpenRouter n'est pas configurée.");
  const openrouter = createOpenRouter({
    apiKey,
    headers: { 'HTTP-Referer': 'https://github.com/sr-0w/opendots', 'X-Title': 'OpenDots' },
  });
  const settings: Record<string, unknown> = {};
  if (cfg.providerOrder?.length) settings.provider = { order: cfg.providerOrder, allow_fallbacks: true };
  const openrouterOptions: Record<string, unknown> = {};
  if (cfg.reasoning) openrouterOptions.reasoning = { effort: cfg.reasoning };
  return {
    model: openrouter.chat(cfg.model, settings as any),
    providerOptions: { openrouter: openrouterOptions },
    label: cfg.model,
  };
}

// --- Catalogues ---------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  provider: 'openrouter' | 'ollama';
  contextLength: number | null;
  tools: boolean;
  reasoning: boolean;
  vision?: boolean;
  promptPrice: number | null; // $ / M tokens
  completionPrice: number | null;
}

let openrouterCache: { at: number; models: ModelInfo[] } | null = null;

export async function listOpenRouterModels(): Promise<ModelInfo[]> {
  if (openrouterCache && Date.now() - openrouterCache.at < 10 * 60_000) return openrouterCache.models;
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter a répondu ${res.status}`);
  const body = (await res.json()) as { data: any[] };
  const models: ModelInfo[] = body.data
    .filter((m) => (m.architecture?.output_modalities ?? ['text']).includes('text'))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: 'openrouter' as const,
      contextLength: m.context_length ?? null,
      tools: (m.supported_parameters ?? []).includes('tools'),
      vision: (m.architecture?.input_modalities ?? []).includes('image'),
      reasoning: (m.supported_parameters ?? []).includes('reasoning'),
      promptPrice: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null,
      completionPrice: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null,
    }));
  openrouterCache = { at: Date.now(), models };
  return models;
}

export async function listOpenRouterEndpoints(modelId: string): Promise<string[]> {
  const res = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { endpoints?: { provider_name: string }[] } };
  return [...new Set((body.data?.endpoints ?? []).map((e) => e.provider_name))];
}

export async function validateOpenRouterKey(key: string): Promise<{ ok: boolean; error?: string; label?: string }> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Clé refusée par OpenRouter.' };
    if (!res.ok) return { ok: false, error: `OpenRouter a répondu ${res.status}.` };
    const body = (await res.json()) as { data?: { label?: string } };
    return { ok: true, label: body.data?.label };
  } catch (err) {
    return { ok: false, error: `Impossible de joindre OpenRouter : ${(err as Error).message}` };
  }
}

export async function listOllamaModels(url?: string): Promise<ModelInfo[]> {
  const base = (url ?? (await getSetting('ollama.url')) ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status}`);
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
    provider: 'ollama' as const,
    contextLength: null,
    tools: true,
    reasoning: false,
    promptPrice: 0,
    completionPrice: 0,
  }));
}

/** Vérifie qu'un modèle existe et sait appeler des outils. */
export async function checkModel(cfg: ModelConfig): Promise<{ ok: boolean; warning?: string; error?: string }> {
  try {
    if (cfg.provider === 'ollama') {
      const models = await listOllamaModels();
      return models.some((m) => m.id === cfg.model || m.id === `${cfg.model}:latest`)
        ? { ok: true }
        : { ok: false, error: `Modèle Ollama « ${cfg.model} » introuvable.` };
    }
    const models = await listOpenRouterModels();
    const found = models.find((m) => m.id === cfg.model);
    if (!found) return { ok: false, error: `Modèle OpenRouter « ${cfg.model} » introuvable.` };
    if (!found.tools) {
      return { ok: true, warning: "Ce modèle ne prend pas en charge les appels d'outils : le compagnon ne pourra pas agir." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: true, warning: `Vérification impossible : ${(err as Error).message}` };
  }
}
