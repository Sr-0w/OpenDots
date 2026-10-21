import type { AgentState } from "@opendots/shared";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

const ACTIVE: AgentState[] = ["thinking", "working", "collaborating", "awake"];

/**
 * Représentation provisoire d'un compagnon : un petit « dot » nacré avec deux
 * yeux. Les mascottes 3D arriveront en dernière phase ; l'état affiché reflète
 * toujours l'état réel du backend.
 */
export function DotAvatar({
  color,
  state = "available",
  size = 36,
  className,
  named = true,
}: {
  color: string;
  state?: AgentState;
  size?: number;
  className?: string;
  named?: boolean;
}) {
  const active = ACTIVE.includes(state);
  return (
    <div
      className={cn("od-dot relative shrink-0 rounded-full", className)}
      data-active={active}
      data-state={state}
      style={
        {
          width: size,
          height: size,
          "--dot": color,
          background: `radial-gradient(circle at 32% 28%, color-mix(in oklch, white 75%, ${color}) 0%, ${color} 58%, color-mix(in oklch, black 18%, ${color}) 100%)`,
          boxShadow: `inset 0 -${size / 10}px ${size / 5}px color-mix(in oklch, black 12%, transparent), inset 0 ${size / 14}px ${size / 8}px color-mix(in oklch, white 45%, transparent)`,
        } as CSSProperties
      }
      aria-hidden
    >
      <div className="od-eyes absolute inset-0 flex items-center justify-center" style={{ gap: size * 0.16, paddingBottom: size * 0.04 }}>
        {[0, 1].map((i) => (
          <span
            key={i}
            className="od-eye block rounded-full bg-[#1b1d2b]"
            style={{
              width: size * 0.12,
              height: size * (named ? 0.2 : 0.16),
              animationDelay: `${i * 0.04}s`,
            }}
          />
        ))}
      </div>
      {state === "error" && (
        <span className="absolute -right-0.5 -bottom-0.5 size-[30%] rounded-full border-2 border-background bg-red-500" />
      )}
    </div>
  );
}
