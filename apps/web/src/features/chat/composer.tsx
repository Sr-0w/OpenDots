import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Champ de saisie inspiré du PromptInput d'AI Elements, réduit à l'essentiel. */
export function Composer({
  onSubmit,
  onStop,
  busy,
  placeholder,
  autoFocus,
}: {
  onSubmit: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) ref.current?.focus();
  }, [autoFocus]);

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "relative flex w-full items-end gap-2 rounded-3xl border bg-card p-2 pl-4 shadow-sm transition-shadow",
        "focus-within:border-ring/60 focus-within:shadow-md",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      {busy ? (
        <Button type="button" size="icon" variant="secondary" className="size-9 rounded-full" onClick={onStop} aria-label="Arrêter">
          <SquareIcon className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="icon" className="size-9 rounded-full" disabled={!value.trim()} aria-label="Envoyer">
          <ArrowUpIcon />
        </Button>
      )}
    </form>
  );
}
