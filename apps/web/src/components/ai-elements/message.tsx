import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo, useEffect, useState } from "react";
import { Streamdown } from "streamdown";

// Adapté d'AI Elements (vercel/ai-elements) : branches retirées, plugins limités
// à la coloration du code pour garder l'application légère.

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[92%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[15px] leading-relaxed",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// La coloration syntaxique (shiki) n'est chargée qu'à l'apparition d'un bloc de code.
type CodePlugin = typeof import("@streamdown/code").code;
let codePlugin: CodePlugin | null = null;
let codePluginPromise: Promise<CodePlugin> | null = null;

export function useCodePlugin(text: unknown): { code: CodePlugin } | undefined {
  const needed = typeof text === "string" && text.includes("```");
  const [plugin, setPlugin] = useState<CodePlugin | null>(codePlugin);
  useEffect(() => {
    if (!needed || plugin) return;
    codePluginPromise ??= import("@streamdown/code").then((m) => (codePlugin = m.code));
    codePluginPromise.then(setPlugin).catch(() => {});
  }, [needed, plugin]);
  return plugin ? { code: plugin } : undefined;
}

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => {
    const plugins = useCodePlugin(props.children);
    return (
      <Streamdown
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={plugins}
        {...props}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
