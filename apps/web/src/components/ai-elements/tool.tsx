import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckIcon, ChevronDownIcon, CircleDashedIcon, LoaderIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

// Adapté d'AI Elements (vercel/ai-elements) : libellés en français, rendu compact.

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("group/tool not-prose w-full", className)} {...props} />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <CircleDashedIcon className="size-3.5 text-amber-500" />,
  "approval-responded": <CheckIcon className="size-3.5 text-sky-500" />,
  "input-available": <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />,
  "input-streaming": <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />,
  "output-available": <CheckIcon className="size-3.5 text-emerald-500" />,
  "output-denied": <XIcon className="size-3.5 text-orange-500" />,
  "output-error": <XIcon className="size-3.5 text-red-500" />,
};

export type ToolHeaderProps = {
  title: string;
  state: ToolPart["state"];
  failed?: boolean;
  icon?: ReactNode;
  className?: string;
};

export const ToolHeader = ({ className, title, state, failed, icon }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex items-center gap-2 rounded-full border border-border/70 bg-card/60 py-1 pr-2.5 pl-2 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground",
      className
    )}
  >
    {failed ? statusIcons["output-error"] : statusIcons[state]}
    {icon}
    <span className="font-medium">{title}</span>
    <ChevronDownIcon className="size-3 opacity-60 transition-transform group-data-[state=open]/tool:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 space-y-3 rounded-xl border border-border/70 bg-card/40 p-3 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
);

const Json = ({ value }: { value: unknown }) => (
  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed">
    {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
  </pre>
);

export const ToolInput = ({ input }: { input: ToolPart["input"] }) => (
  <div className="space-y-1.5">
    <h4 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">Paramètres</h4>
    <Json value={input ?? {}} />
  </div>
);

export const ToolOutput = ({ output, errorText }: { output: ToolPart["output"]; errorText: ToolPart["errorText"] }) => {
  if (!(output || errorText)) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {errorText ? "Erreur" : "Résultat"}
      </h4>
      {errorText ? <div className="rounded-lg bg-destructive/10 p-2.5 text-destructive text-xs">{errorText}</div> : <Json value={output} />}
    </div>
  );
};
