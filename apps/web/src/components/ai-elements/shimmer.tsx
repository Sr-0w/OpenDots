import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType } from "react";
import { memo } from "react";

// Adapté d'AI Elements : version CSS pure (sans motion) pour alléger le bundle.

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
}

const ShimmerComponent = ({ children, as: Component = "p", className, duration = 2 }: TextShimmerProps) => (
  <Component
    className={cn(
      "od-shimmer relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]",
      className
    )}
    style={
      {
        "--spread": `${Math.max(children.length * 2, 24)}px`,
        "--duration": `${duration}s`,
        backgroundImage:
          "linear-gradient(90deg,#0000 calc(50% - var(--spread)),var(--color-background),#0000 calc(50% + var(--spread))), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
      } as CSSProperties
    }
  >
    {children}
  </Component>
);

export const Shimmer = memo(ShimmerComponent);
