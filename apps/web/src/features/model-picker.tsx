import { useEffect, useMemo, useState } from "react";
import { BrainIcon, CheckIcon, SearchIcon, WrenchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, type ModelInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

const RECOMMENDED = [
  "openai/gpt-oss-120b",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
  "deepseek/deepseek-chat-v3.1",
  "moonshotai/kimi-k2",
];

function price(m: ModelInfo) {
  if (m.provider === "ollama") return "local";
  if (m.promptPrice === null) return "";
  if (m.promptPrice === 0 && m.completionPrice === 0) return "gratuit";
  return `$${m.promptPrice?.toFixed(2)} / $${m.completionPrice?.toFixed(2)} par M`;
}

/** Sélecteur de modèle OpenRouter (ou Ollama) avec recherche. */
export function ModelPicker({
  value,
  onChange,
  provider = "openrouter",
  className,
}: {
  value: string | null;
  onChange: (model: ModelInfo) => void;
  provider?: "openrouter" | "ollama";
  className?: string;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setModels(null);
    setError(null);
    (provider === "ollama" ? api.ollamaModels() : api.openrouterModels())
      .then(setModels)
      .catch((e) => setError(e.message));
  }, [provider]);

  const list = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const filtered = models.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    const rank = (m: ModelInfo) => {
      const r = RECOMMENDED.indexOf(m.id);
      return (r === -1 ? 100 : r) + (m.tools ? 0 : 1000);
    };
    return (q ? filtered : [...filtered].sort((a, b) => rank(a) - rank(b))).slice(0, 60);
  }, [models, query]);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={provider === "ollama" ? "Rechercher un modèle local…" : "Rechercher parmi les modèles OpenRouter…"}
          className="pl-9"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card/50 p-1">
        {error && <p className="p-3 text-destructive text-sm">{error}</p>}
        {!models && !error && <p className="p-3 text-muted-foreground text-sm">Chargement des modèles…</p>}
        {models && list.length === 0 && <p className="p-3 text-muted-foreground text-sm">Aucun modèle trouvé.</p>}
        {list.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
              value === m.id && "bg-accent",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-sm">{m.name}</span>
                {RECOMMENDED[0] === m.id && (
                  <span className="rounded-full bg-brand/15 px-1.5 py-0.5 font-medium text-[10px] text-brand">recommandé</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <span className="truncate font-mono">{m.id}</span>
                {price(m) && <span className="shrink-0">· {price(m)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              {m.tools ? (
                <WrenchIcon className="size-3.5" aria-label="Outils" />
              ) : (
                <span className="text-[10px] text-amber-600">sans outils</span>
              )}
              {m.reasoning && <BrainIcon className="size-3.5" aria-label="Raisonnement" />}
              {value === m.id && <CheckIcon className="size-4 text-foreground" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
